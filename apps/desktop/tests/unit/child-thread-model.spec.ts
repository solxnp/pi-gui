import { expect, test } from "@playwright/test";
import { parseChildModel } from "../../electron/orchestration/app-store-orchestration";

test("splits provider from model id at the first slash only", () => {
  // Model ids carry slashes themselves: commandcode/deepseek/deepseek-v4.1-flash.
  expect(parseChildModel("opencode-go/glm-5.3-flash")).toEqual({
    provider: "opencode-go",
    modelId: "glm-5.3-flash",
  });
  expect(parseChildModel("commandcode/deepseek/deepseek-v4.1-flash")).toEqual({
    provider: "commandcode",
    modelId: "deepseek/deepseek-v4.1-flash",
  });
  expect(parseChildModel("  opencode-go/glm-5.3-flash  ")).toEqual({
    provider: "opencode-go",
    modelId: "glm-5.3-flash",
  });
});

test("refuses anything that is not provider/modelId", () => {
  // Each of these must fail loudly: silently inheriting the parent's model would make a
  // cross-model review run on the same model and share its blind spots.
  for (const value of ["", "   ", "glm-5.3-flash", "/glm-5.3-flash", "opencode-go/"]) {
    expect(parseChildModel(value), value).toBeUndefined();
  }
});

test("create_child_thread refuses a non-string model instead of inheriting", async () => {
  // `model: 123` used to be dropped by the string coercion, which silently ran the child on the
  // parent's model — exactly the case a cross-model review must not hit.
  const { createOrchestrationRuntimeTools } =
    await import("../../electron/orchestration/orchestration-runtime");
  const calls: { readonly model?: string }[] = [];
  const bridge = {
    createChildThread: async (_ctx: unknown, input: { readonly model?: string }) => {
      calls.push(input);
      return { content: [{ type: "text" as const, text: "created" }], details: {} };
    },
  };
  const tool = createOrchestrationRuntimeTools(bridge as never).find(
    (entry) => entry.name === "create_child_thread",
  );
  if (!tool) throw new Error("create_child_thread was not registered");

  const ctx = {} as never;
  for (const model of [123, { provider: "x" }, ["a/b"]] as unknown[]) {
    await expect(
      tool.execute("call-1", { prompt: "Do the work.", model }, undefined, undefined, ctx),
      JSON.stringify(model),
    ).rejects.toThrow(/model must be a string/);
  }
  // A blank string is present but useless: refuse it rather than treat it as "not given".
  await expect(
    tool.execute("call-2", { prompt: "Do the work.", model: "   " }, undefined, undefined, ctx),
  ).rejects.toThrow(/non-empty/);
  expect(calls).toHaveLength(0);

  // Omitting the field is the only way to inherit, and then the bridge sees no model at all.
  await tool.execute("call-3", { prompt: "Do the work." }, undefined, undefined, ctx);
  await tool.execute(
    "call-4",
    { prompt: "Do the work.", model: "opencode-go/glm-5.3-flash" },
    undefined,
    undefined,
    ctx,
  );
  // Calling with no model must leave it absent, not set to undefined or an empty string.
  expect(calls).toHaveLength(2);
  expect(calls[0]).not.toHaveProperty("model");
  expect(calls[1]).toMatchObject({ model: "opencode-go/glm-5.3-flash" });
});
