import { expect, test } from "@playwright/test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { EXTENSION_PIN_CUSTOM_TYPE } from "@pi-gui/session-driver";
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
