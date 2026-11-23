import { expect, test } from "@playwright/test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { EXTENSION_PIN_CUSTOM_TYPE, type ExtensionCardRow } from "@pi-gui/session-driver";
import { showsRowProgress } from "../../src/features/conversation/extension-row-progress";
import {
  createPlanRuntimeExtension,
  PLAN_PIN_KEY,
  planPinPayload,
  planStepsFromParams,
  updatePlanToolName,
  type PlanStep,
} from "../../electron/plan/plan-runtime";

interface RegisteredTool {
  readonly name: string;
  execute(
    toolCallId: string,
    params: unknown,
    signal: undefined,
    onUpdate: undefined,
    ctx: unknown,
  ): Promise<{ content: readonly { readonly text: string }[]; details: Record<string, unknown> }>;
}

/** The tool `createPlanRuntimeExtension` registers, plus the entries it appended. */
async function registerPlanExtension(): Promise<{
  readonly tool: RegisteredTool;
  readonly entries: readonly { readonly customType: string; readonly data: unknown }[];
}> {
  const entries: { customType: string; data: unknown }[] = [];
  let tool: RegisteredTool | undefined;
  const pi = {
    registerTool: (next: RegisteredTool) => {
      tool = next;
      return () => {};
    },
    appendEntry: (customType: string, data?: unknown) => {
      entries.push({ customType, data });
    },
  } as unknown as ExtensionAPI;
  await createPlanRuntimeExtension()(pi);
  if (!tool) {
    throw new Error("The plan extension did not register a tool.");
  }
  return { tool, entries };
}

test("registers update_plan and writes a keyed pin the app reduces by key", async () => {
  const { tool, entries } = await registerPlanExtension();
  expect(tool.name).toBe(updatePlanToolName);

  const steps: PlanStep[] = [
    { step: "Read the ledger", status: "done" },
    { step: "Split the modules", status: "in_progress" },
    { step: "Verify on desktop", status: "pending" },
  ];
  const result = await tool.execute("call-1", { title: "计划", steps }, undefined, undefined, {});

  expect(entries).toHaveLength(1);
  expect(entries[0]?.customType).toBe(EXTENSION_PIN_CUSTOM_TYPE);
  const payload = entries[0]?.data as Record<string, unknown>;
  expect(payload.key).toBe(PLAN_PIN_KEY);
  expect(payload.title).toBe("计划");
  expect(payload.subtitle).toBe("1/3 步完成");
  expect(payload.rows).toEqual([
    { label: "●", value: "Read the ledger", status: "done" },
    { label: "◐", value: "Split the modules", status: "in_progress" },
    { label: "○", value: "Verify on desktop", status: "pending" },
  ]);
  expect(payload.progress).toBeCloseTo(1 / 3);
  expect(result.details).toMatchObject({ action: "pi_gui_update_plan" });
});

test("rewriting the same key replaces the earlier card instead of stacking", async () => {
  const { tool, entries } = await registerPlanExtension();
  await tool.execute(
    "call-1",
    { steps: [{ step: "One", status: "in_progress" }] },
    undefined,
    undefined,
    {},
  );
  await tool.execute(
    "call-2",
    { steps: [{ step: "One", status: "done" }] },
    undefined,
    undefined,
    {},
  );

  expect(entries).toHaveLength(2);
  for (const entry of entries) {
    expect((entry.data as Record<string, unknown>).key).toBe(PLAN_PIN_KEY);
  }
  expect((entries[1]?.data as Record<string, unknown>).rows).toEqual([
    { label: "●", value: "One", status: "done" },
  ]);
});

test("remove: true unpins the card", async () => {
  const { tool, entries } = await registerPlanExtension();
  await tool.execute("call-1", { remove: true }, undefined, undefined, {});

  expect(entries[0]?.data).toEqual({ key: PLAN_PIN_KEY, remove: true });
});

test("rejects a plan with no usable steps and appends nothing", async () => {
  const { tool, entries } = await registerPlanExtension();
  const result = await tool.execute("call-1", { steps: [] }, undefined, undefined, {});

  expect(entries).toHaveLength(0);
  expect(result.details.error).toBe("Invalid steps");
  expect(result.content[0]?.text).toContain("steps array");
});

test("defaults the first step to in_progress and the rest to pending", () => {
  const steps = planStepsFromParams({ steps: [{ step: "A" }, { step: "B" }] });
  expect(steps).toEqual([
    { step: "A", status: "in_progress" },
    { step: "B", status: "pending" },
  ]);
});

test("builds one row per step with a status mark and a done counter", () => {
  const payload = planPinPayload("计划", [
    { step: "A", status: "done" },
    { step: "B", status: "blocked" },
  ]);
  expect(payload.rows).toEqual([
    { label: "●", value: "A", status: "done" },
    { label: "✕", value: "B", status: "blocked" },
  ]);
  expect(payload.subtitle).toBe("1/2 步完成");
  // A blocked step is stopped, not advanced: only the done one counts.
  expect(payload.progress).toBe(0.5);
});

test("a step carries its own fraction, and a done step's fraction is dropped", () => {
  const steps = planStepsFromParams({
    steps: [
      { step: "A", status: "in_progress", progress: 0.4 },
      { step: "B", status: "in_progress", progress: 1.4 },
      { step: "C", status: "in_progress", progress: -2 },
      { step: "D", status: "in_progress", progress: "half" },
      { step: "E", status: "done", progress: 0.2 },
    ],
  });
  expect(steps).toEqual([
    { step: "A", status: "in_progress", progress: 0.4 },
    { step: "B", status: "in_progress", progress: 1 },
    { step: "C", status: "in_progress", progress: 0 },
    { step: "D", status: "in_progress" },
    { step: "E", status: "done", progress: 0.2 },
  ]);

  const payload = planPinPayload("计划", steps ?? []);
  // Fractions are written clamped; a done step drops its stale 0.2 because `status` is the truth
  // for a finished step — writing 1 as well would be a second source for the same fact.
  expect(payload.rows as readonly { readonly value: string; readonly progress?: number }[]).toEqual(
    [
      { label: "◐", value: "A", status: "in_progress", progress: 0.4 },
      { label: "◐", value: "B", status: "in_progress", progress: 1 },
      { label: "◐", value: "C", status: "in_progress", progress: 0 },
      { label: "◐", value: "D", status: "in_progress" },
      { label: "●", value: "E", status: "done" },
    ],
  );
  // One of five finished, plus 0.4 + 1 + 0 + 0 from the running steps.
  expect(payload.progress).toBeCloseTo((1 + 1.4) / 5);
});

test("the card's progress counts a running step's fraction, so it never trails its own rows", () => {
  // The contradiction a reviewer caught: 1 of 4 done showed 25% while a row read 45%.
  const steps: PlanStep[] = [
    { step: "A", status: "done" },
    { step: "B", status: "in_progress", progress: 0.45 },
    { step: "C", status: "pending" },
    { step: "D", status: "blocked" },
  ];
  const payload = planPinPayload("计划", steps);
  // Overall is not meant to exceed the row's own fraction: they have different denominators.
  // What matters is that the card counts the running step instead of only finished ones.
  expect(payload.progress).toBeCloseTo((1 + 0.45) / 4);
  expect(payload.progress).toBeGreaterThan(1 / 4);

  // A blocked step's fraction, if one is written anyway, must not advance the card.
  const withBlockedFraction: PlanStep[] = [{ step: "A", status: "blocked", progress: 0.9 }];
  expect(planPinPayload("计划", withBlockedFraction).progress).toBe(0);
});

test("updating the same step's fraction rewrites that row instead of stacking", async () => {
  const { tool, entries } = await registerPlanExtension();
  await tool.execute(
    "call-1",
    { steps: [{ step: "拆模块", status: "in_progress", progress: 0.2 }] },
    undefined,
    undefined,
    {},
  );
  await tool.execute(
    "call-2",
    { steps: [{ step: "拆模块", status: "in_progress", progress: 0.6 }] },
    undefined,
    undefined,
    {},
  );

  expect(entries).toHaveLength(2);
  for (const entry of entries) {
    expect((entry.data as Record<string, unknown>).key).toBe(PLAN_PIN_KEY);
  }
  expect((entries[1]?.data as Record<string, unknown>).rows).toEqual([
    { label: "◐", value: "拆模块", status: "in_progress", progress: 0.6 },
  ]);
  expect((entries[1]?.data as Record<string, unknown>).progress).toBeCloseTo(0.6);
});

test("a fraction on a pending step neither advances the card nor draws a bar", () => {
  // A stale fraction on a step that is not moving would put a moving bar under a hollow ring.
  const payload = planPinPayload("计划", [
    { step: "A", status: "pending", progress: 0.7 },
    { step: "B", status: "in_progress", progress: 0.2 },
  ]);
  expect(payload.progress).toBeCloseTo(0.1);

  const rows = payload.rows as readonly ExtensionCardRow[];
  // The fraction is still reported on the row; the renderer decides not to draw it.
  expect(rows[0]).toEqual({ label: "○", value: "A", status: "pending", progress: 0.7 });
  expect(showsRowProgress(rows[0] ?? {})).toBe(false);
  expect(showsRowProgress(rows[1] ?? {})).toBe(true);
  // A plain card row (no status) is not a plan step, so its fraction still draws.
  expect(showsRowProgress({ progress: 0.5 })).toBe(true);
  expect(showsRowProgress({ status: "done", progress: 1 })).toBe(false);
});

test("an eta is rounded, kept in range, and carried onto the row", () => {
  const steps = planStepsFromParams({
    steps: [
      { step: "A", status: "in_progress", etaMinutes: 4.6 },
      { step: "F", status: "pending", etaMinutes: 0.4 },
      { step: "B", status: "pending", etaMinutes: 0 },
      { step: "C", status: "pending", etaMinutes: -5 },
      { step: "D", status: "pending", etaMinutes: 24 * 60 + 1 },
      { step: "E", status: "pending", etaMinutes: "soon" },
    ],
  });
  expect(steps?.map((step) => step.etaMinutes)).toEqual([
    5,
    undefined,
    undefined,
    undefined,
    undefined,
  ]);

  const payload = planPinPayload("计划", steps ?? []);
  const rows = payload.rows as readonly { readonly etaMinutes?: number }[];
  expect(rows[0]?.etaMinutes).toBe(5);
  expect(rows[1]?.etaMinutes).toBeUndefined();
});
