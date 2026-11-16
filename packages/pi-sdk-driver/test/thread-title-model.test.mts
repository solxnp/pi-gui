import test from "node:test";
import assert from "node:assert/strict";
import { pickThreadTitleModel } from "../dist/thread-title-generator.js";

const resolvable = {
  provider: "opencode-go",
  id: "deepseek-v4.1-flash",
} as unknown as ReturnType<Parameters<typeof pickThreadTitleModel>[0]["getModel"]>;

const fakeRuntime = {
  getModel: (provider: string, modelId: string) =>
    provider === "opencode-go" && modelId === "deepseek-v4.1-flash" ? resolvable : undefined,
};

await test("the requested model is used when this runtime can resolve it", () => {
  assert.equal(
    pickThreadTitleModel(fakeRuntime, {
      provider: "opencode-go",
      modelId: "deepseek-v4.1-flash",
    }),
    resolvable,
  );
});

await test("a model only an extension registers falls back to the runtime default", () => {
  // Auto-title builds a bare ModelRuntime with no extensions, so a virtual provider such as a
  // router is invisible here. Returning undefined keeps the placeholder from sticking forever.
  assert.equal(
    pickThreadTitleModel(fakeRuntime, {
      provider: "commandcode",
      modelId: "deepseek/deepseek-v4.1-flash",
    }),
    undefined,
  );
});

await test("no selection means the runtime default", () => {
  assert.equal(pickThreadTitleModel(fakeRuntime, undefined), undefined);
});
