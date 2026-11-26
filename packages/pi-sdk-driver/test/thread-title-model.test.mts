import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtemp, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  fallbackThreadTitle,
  generateThreadTitle,
  pickThreadTitleModel,
} from "../dist/thread-title-generator.js";
import type { WorkspaceModelContext } from "../dist/thread-title-generator.js";

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

await test("an unresolvable selection falls back to the runtime default", () => {
  // A stale selection (provider removed, model dropped from the catalog) must not cost the
  // thread its title; returning undefined lets the caller's default model apply.
  assert.equal(
    pickThreadTitleModel(fakeRuntime, { provider: "gone-provider", modelId: "gone-model" }),
    undefined,
  );
});

await test("no selection means the runtime default", () => {
  assert.equal(pickThreadTitleModel(fakeRuntime, undefined), undefined);
});

await test("fallbackThreadTitle compresses to one line and caps the length", () => {
  assert.equal(fallbackThreadTitle("  fix   the   title flow  "), "fix the title flow");
  assert.equal(fallbackThreadTitle("\n\n  second line wins\nthird"), "second line wins");
  assert.equal(fallbackThreadTitle("   "), "");
  const capped = fallbackThreadTitle("a".repeat(80));
  assert.equal(capped.length, 36);
  assert.ok(capped.endsWith("..."));
});

/** A local OpenAI-compatible endpoint, so the title prompt really runs end to end. */
async function startTitleEndpoint(options: {
  readonly status?: number;
  readonly text?: string;
  readonly error?: string;
}): Promise<{ baseUrl: string; requestBodies: string[]; close: () => Promise<void> }> {
  const requestBodies: string[] = [];
  const server = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk: Buffer) => {
      body += chunk.toString();
    });
    request.on("end", () => {
      requestBodies.push(body);
      if (options.status && options.status !== 200) {
        response.writeHead(options.status, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ error: { message: options.error ?? "failed" } }));
        return;
      }
      response.writeHead(200, { "Content-Type": "text/event-stream" });
      const write = (delta: unknown, finishReason: string | null) => {
        response.write(
          `data: ${JSON.stringify({
            id: "title",
            object: "chat.completion.chunk",
            model: "title-model",
            choices: [{ index: 0, delta, finish_reason: finishReason }],
          })}\n\n`,
        );
      };
      write({ role: "assistant", content: options.text ?? "" }, null);
      write({}, "stop");
      response.end("data: [DONE]\n\n");
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${port}/v1`,
    requestBodies,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

async function makeAgentDir(baseUrl: string): Promise<string> {
  const agentDir = await mkdtemp(join(tmpdir(), "pi-gui-title-"));
  await mkdir(agentDir, { recursive: true });
  await writeFile(join(agentDir, "auth.json"), "{}");
  await writeFile(join(agentDir, "settings.json"), "{}");
  await writeFile(
    join(agentDir, "models.json"),
    JSON.stringify({
      providers: {
        "title-provider": {
          baseUrl,
          api: "openai-completions",
          apiKey: "test-key",
          models: [{ id: "title-model", name: "Title Model", input: ["text"] }],
        },
      },
    }),
  );
  return agentDir;
}

await test("the workspace default model is what the title prompt uses", async () => {
  // Regression (title stuck on "New thread"): the generator loaded a bare runtime, so the
  // workspace default model never reached the request and an unrelated provider was asked
  // instead — one that then failed on quota. The request must carry the default provider.
  const endpoint = await startTitleEndpoint({ text: "Title from default model" });
  try {
    const agentDir = await makeAgentDir(endpoint.baseUrl);
    const { ModelRuntime } = await import("@earendil-works/pi-coding-agent");
    const runtime = await ModelRuntime.create({
      authPath: join(agentDir, "auth.json"),
      modelsPath: join(agentDir, "models.json"),
      refreshOnCreate: false,
    });
    await runtime.refresh({ allowNetwork: false });
    const context: WorkspaceModelContext = {
      modelRuntime: runtime,
      defaultProvider: "title-provider",
      defaultModelId: "title-model",
    };
    const title = await generateThreadTitle(
      { workspaceId: "w", path: agentDir },
      { prompt: "hello there" },
      { agentDir, loadWorkspaceModelContext: async () => context },
    );
    assert.equal(title, "Title from default model");
    assert.equal(endpoint.requestBodies.length, 1);
  } finally {
    await endpoint.close();
  }
});

await test("a failing title request still titles the thread from the first message", async () => {
  // Regression: a provider error left the placeholder in place forever. Now the user's own
  // first line becomes the title, so the thread is never stuck on "New thread".
  const endpoint = await startTitleEndpoint({ status: 429, error: "quota exhausted" });
  try {
    const agentDir = await makeAgentDir(endpoint.baseUrl);
    const { ModelRuntime } = await import("@earendil-works/pi-coding-agent");
    const runtime = await ModelRuntime.create({
      authPath: join(agentDir, "auth.json"),
      modelsPath: join(agentDir, "models.json"),
      refreshOnCreate: false,
    });
    await runtime.refresh({ allowNetwork: false });
    const title = await generateThreadTitle(
      { workspaceId: "w", path: agentDir },
      { prompt: "Why still New thread?\nsecond line" },
      {
        agentDir,
        loadWorkspaceModelContext: async () => ({
          modelRuntime: runtime,
          defaultProvider: "title-provider",
          defaultModelId: "title-model",
        }),
      },
    );
    assert.equal(title, "Why still New thread?");
  } finally {
    await endpoint.close();
  }
});

await test("an aborted generation returns no title instead of a fallback", async () => {
  const controller = new AbortController();
  controller.abort();
  const title = await generateThreadTitle(
    { workspaceId: "w", path: "/tmp" },
    { prompt: "anything", signal: controller.signal },
    { agentDir: "/tmp" },
  );
  assert.equal(title, null);
});

await test("a virtual default model is swapped for a real model of the same provider", async () => {
  // `commandcode/auto` is a router: prompting it directly in the one-shot title session fails
  // with "Extension runtime not initialized", which used to leave the thread unnamed. A router
  // selection must resolve to a physical model of the same provider instead.
  const endpoint = await startTitleEndpoint({ text: "Routed title" });
  try {
    const agentDir = await makeAgentDir(endpoint.baseUrl);
    const { ModelRuntime } = await import("@earendil-works/pi-coding-agent");
    const runtime = await ModelRuntime.create({
      authPath: join(agentDir, "auth.json"),
      modelsPath: join(agentDir, "models.json"),
      refreshOnCreate: false,
    });
    await runtime.refresh({ allowNetwork: false });
    runtime.registerVirtualModel({
      provider: "title-provider",
      id: "router",
      name: "Router",
      contextWindow: 128000,
      maxTokens: 8192,
      input: ["text"],
      route: async () => ({ model: { provider: "title-provider", id: "title-model" } }),
    } as never);

    const title = await generateThreadTitle(
      { workspaceId: "w", path: agentDir },
      { prompt: "route the title" },
      {
        agentDir,
        loadWorkspaceModelContext: async () => ({
          modelRuntime: runtime,
          defaultProvider: "title-provider",
          defaultModelId: "router",
        }),
      },
    );
    assert.equal(title, "Routed title");
  } finally {
    await endpoint.close();
  }
});
