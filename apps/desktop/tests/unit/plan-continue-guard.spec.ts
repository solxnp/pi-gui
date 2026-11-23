import { expect, test } from "@playwright/test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  CONTINUE_AFTER_UNFINISHED_PLAN_MAX,
  CONTINUE_NUDGE_CUSTOM_TYPE,
  CONTINUE_NUDGE_TEXT,
  createPlanRuntimeExtension,
  shouldContinueUnfinishedPlan,
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
  ): Promise<{ readonly content: readonly { readonly text: string }[]; details: unknown }>;
}

type Handler = (event: never) => unknown;

/** The plan extension's tool plus the handlers it registered on `pi.on`. */
async function registerExtension(): Promise<{
  readonly tool: RegisteredTool;
  readonly fire: (event: string, payload: unknown) => unknown;
}> {
  let tool: RegisteredTool | undefined;
  const handlers = new Map<string, Handler>();
  const pi = {
    registerTool: (next: RegisteredTool) => {
      tool = next;
      return () => {};
    },
    appendEntry: () => {},
    on: (event: string, handler: Handler) => {
      handlers.set(event, handler);
      return () => {};
    },
  } as unknown as ExtensionAPI;
  await createPlanRuntimeExtension()(pi);
  if (!tool) {
    throw new Error("The plan extension did not register a tool.");
  }
  return {
    tool,
    fire: (event, payload) => handlers.get(event)?.(payload as never),
  };
}

const unfinished: readonly PlanStep[] = [
  { step: "更新测试断言", status: "done" },
  { step: "扩门禁脚本", status: "in_progress" },
  { step: "跑全量", status: "pending" },
];

test("only a self-ended run with work left is extended", () => {
  const base = {
    steps: unfinished,
    outcome: "completed" as const,
    continuations: 0,
    alreadyContinuing: false,
  };
  expect(shouldContinueUnfinishedPlan(base)).toBe(true);
  expect(shouldContinueUnfinishedPlan({ ...base, steps: [{ step: "A", status: "pending" }] })).toBe(
    true,
  );
  // Every reason not to extend:
  expect(shouldContinueUnfinishedPlan({ ...base, steps: [{ step: "A", status: "done" }] })).toBe(
    false,
  );
  expect(shouldContinueUnfinishedPlan({ ...base, steps: [{ step: "A", status: "blocked" }] })).toBe(
    false,
  );
  expect(shouldContinueUnfinishedPlan({ ...base, steps: undefined })).toBe(false);
  expect(shouldContinueUnfinishedPlan({ ...base, outcome: "aborted" })).toBe(false);
  expect(shouldContinueUnfinishedPlan({ ...base, outcome: "error" })).toBe(false);
  expect(
    shouldContinueUnfinishedPlan({ ...base, continuations: CONTINUE_AFTER_UNFINISHED_PLAN_MAX }),
  ).toBe(false);
  expect(shouldContinueUnfinishedPlan({ ...base, alreadyContinuing: true })).toBe(false);
});

test("a run that ends with the plan unfinished is asked to keep going", async () => {
  const { tool, fire } = await registerExtension();
  await tool.execute("call-1", { steps: unfinished }, undefined, undefined, {});

  const result = (await fire("agent_before_settle", {
    outcome: "completed",
    continue: false,
  })) as { readonly continue: boolean; readonly entries: readonly Record<string, unknown>[] };

  expect(result.continue).toBe(true);
  expect(result.entries).toEqual([
    {
      type: "custom_message",
      customType: CONTINUE_NUDGE_CUSTOM_TYPE,
      display: false,
      content: CONTINUE_NUDGE_TEXT,
    },
  ]);
});

test("the extension stops nudging after its cap and out of a stopped or failed run", async () => {
  const { tool, fire } = await registerExtension();
  await tool.execute("call-1", { steps: unfinished }, undefined, undefined, {});

  const settle = { outcome: "completed", continue: false };
  expect(await fire("agent_before_settle", settle)).toMatchObject({ continue: true });
  expect(await fire("agent_before_settle", settle)).toMatchObject({ continue: true });
  expect(await fire("agent_before_settle", settle)).toBeUndefined();

  expect(
    await fire("agent_before_settle", { outcome: "aborted", continue: false }),
  ).toBeUndefined();
  expect(await fire("agent_before_settle", { outcome: "error", continue: false })).toBeUndefined();
});

test("a new prompt from the user restores the allowance", async () => {
  const { tool, fire } = await registerExtension();
  await tool.execute("call-1", { steps: unfinished }, undefined, undefined, {});
  const settle = { outcome: "completed", continue: false };

  await fire("agent_before_settle", settle);
  await fire("agent_before_settle", settle);
  expect(await fire("agent_before_settle", settle)).toBeUndefined();

  await fire("message_start", { message: { role: "user", content: "再来一条补充" } });
  expect(await fire("agent_before_settle", settle)).toMatchObject({ continue: true });
});

test("removing the card ends the nudging, and a finished plan never starts it", async () => {
  const { tool, fire } = await registerExtension();
  await tool.execute("call-1", { steps: unfinished }, undefined, undefined, {});
  await tool.execute("call-2", { remove: true }, undefined, undefined, {});
  expect(
    await fire("agent_before_settle", { outcome: "completed", continue: false }),
  ).toBeUndefined();

  await tool.execute(
    "call-3",
    { steps: [{ step: "A", status: "done" }] },
    undefined,
    undefined,
    {},
  );
  expect(
    await fire("agent_before_settle", { outcome: "completed", continue: false }),
  ).toBeUndefined();
});
