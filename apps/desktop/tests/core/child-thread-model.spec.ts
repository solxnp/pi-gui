import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import type { SessionRef } from "@pi-gui/session-driver";
import {
  createNamedThread,
  getDesktopState,
  launchDesktop,
  makeUserDataDir,
  makeWorkspace,
  runOrchestrationRuntimeTool,
  seedAgentDir,
  waitForWorkspaceByPath,
  writeProjectExtension,
} from "../helpers/electron-app";

const PARENT_PROVIDER = "parent-model-test";
const CHILD_PROVIDER = "child-model-test";
const PARENT_MODEL_ID = "parent-scripted";
const CHILD_MODEL_ID = "child-scripted";

// Two providers that answer every turn, so the parent's and the child's models are both real and
// distinguishable: the point of `model` on create_child_thread is a reviewer on another model.
const extensionSource = String.raw`
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai";

function scripedProvider(id, modelId, reply) {
  return {
    baseUrl: "http://127.0.0.1:9/never-contact",
    apiKey: "LOCAL_TEST_CANARY",
    api: id,
    models: [{
      id: modelId,
      name: "Scripted",
      reasoning: false,
      input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 128000,
      maxTokens: 4096,
    }],
    streamSimple(model) {
      const done = {
        role: "assistant",
        content: [{ type: "text", text: reply }],
        api: model.api,
        provider: model.provider,
        model: model.id,
        usage: {
          input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
        stopReason: "stop",
        timestamp: Date.now(),
      };
      const stream = createAssistantMessageEventStream();
      queueMicrotask(() => {
        stream.push({ type: "start", partial: { ...done, content: [] } });
        stream.push({ type: "text_delta", contentIndex: 0, delta: reply, partial: done });
        stream.push({ type: "done", reason: "stop", message: done });
      });
      return stream;
    },
  };
}

export default function models(pi) {
  pi.registerProvider(
    "parent-model-test",
    scripedProvider("parent-model-test", "parent-scripted", "PARENT RAN"),
  );
  pi.registerProvider(
    "child-model-test",
    scripedProvider("child-model-test", "child-scripted", "CHILD RAN"),
  );
}
`;

async function selectedSessionRef(window: Parameters<typeof getDesktopState>[0]) {
  const state = await getDesktopState(window);
  if (!state.selectedWorkspaceId || !state.selectedSessionId) {
    throw new Error("Expected a selected session");
  }
  return {
    workspaceId: state.selectedWorkspaceId,
    sessionId: state.selectedSessionId,
  } satisfies SessionRef;
}

test("create_child_thread runs the child on the model the caller names", async () => {
  test.setTimeout(90_000);
  const userDataDir = await makeUserDataDir();
  const agentDir = join(userDataDir, "agent");
  const workspacePath = await makeWorkspace("child-thread-model");
  await seedAgentDir(agentDir, { withOpenAiAuth: false, withDefaultModel: false });
  await writeFile(
    join(agentDir, "settings.json"),
    JSON.stringify({
      defaultProvider: PARENT_PROVIDER,
      defaultModel: PARENT_MODEL_ID,
      enabledModels: [
        `${PARENT_PROVIDER}/${PARENT_MODEL_ID}`,
        `${CHILD_PROVIDER}/${CHILD_MODEL_ID}`,
      ],
      packages: [],
      cacheWarming: "off",
      compaction: { enabled: false },
    }),
  );
  await writeProjectExtension(workspacePath, "models.ts", extensionSource);
  const harness = await launchDesktop(userDataDir, {
    agentDir,
    initialWorkspaces: [workspacePath],
    scrubProviderEnv: true,
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();
    await waitForWorkspaceByPath(window, workspacePath);
    await createNamedThread(window, "Parent on its own model");
    const parentRef = await selectedSessionRef(window);

    const result = await runOrchestrationRuntimeTool(harness, {
      toolName: "create_child_thread",
      toolCallId: "child-on-other-model",
      sessionRef: parentRef,
      params: {
        prompt: "Review the change and score it out of 100.",
        model: `${CHILD_PROVIDER}/${CHILD_MODEL_ID}`,
      },
    });

    // The tool reports the model it actually used, so a caller can tell inheritance from a request.
    expect(result.details).toMatchObject({ model: `${CHILD_PROVIDER}/${CHILD_MODEL_ID}` });
    expect(result.content[0]?.text).toContain(`model: ${CHILD_PROVIDER}/${CHILD_MODEL_ID}`);

    // The child session really runs there, and the parent keeps its own model.
    await expect
      .poll(async () => {
        const state = await getDesktopState(window);
        const child = state.orchestrationChildren.find(
          (entry) => entry.sourceToolCallId === "child-on-other-model",
        );
        if (!child) return undefined;
        const session = state.workspaces
          .flatMap((workspace) => workspace.sessions)
          .find((entry) => entry.id === child.childSessionId);
        const config = session?.config;
        // Both halves matter: a provider id alone would hide a child that fell back to the
        // provider's default model.
        return config ? `${config.provider}/${config.modelId ?? ""}` : undefined;
      })
      .toBe(`${CHILD_PROVIDER}/${CHILD_MODEL_ID}`);

    const parentSession = (await getDesktopState(window)).workspaces
      .flatMap((workspace) => workspace.sessions)
      .find((entry) => entry.id === parentRef.sessionId);
    expect(parentSession?.config?.provider).toBe(PARENT_PROVIDER);
  } finally {
    await harness.close();
  }
});

test("a malformed model is refused instead of silently inheriting", async () => {
  test.setTimeout(90_000);
  const userDataDir = await makeUserDataDir();
  const agentDir = join(userDataDir, "agent");
  const workspacePath = await makeWorkspace("child-thread-model-invalid");
  await seedAgentDir(agentDir, { withOpenAiAuth: false, withDefaultModel: false });
  await writeFile(
    join(agentDir, "settings.json"),
    JSON.stringify({
      defaultProvider: PARENT_PROVIDER,
      defaultModel: PARENT_MODEL_ID,
      enabledModels: [
        `${PARENT_PROVIDER}/${PARENT_MODEL_ID}`,
        `${CHILD_PROVIDER}/${CHILD_MODEL_ID}`,
      ],
      packages: [],
      cacheWarming: "off",
      compaction: { enabled: false },
    }),
  );
  await writeProjectExtension(workspacePath, "models.ts", extensionSource);
  const harness = await launchDesktop(userDataDir, {
    agentDir,
    initialWorkspaces: [workspacePath],
    scrubProviderEnv: true,
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();
    await waitForWorkspaceByPath(window, workspacePath);
    await createNamedThread(window, "Parent refuses a bad model");
    const parentRef = await selectedSessionRef(window);

    const failure = await runOrchestrationRuntimeTool(harness, {
      toolName: "create_child_thread",
      toolCallId: "child-bad-model",
      sessionRef: parentRef,
      params: { prompt: "Do the work.", model: "no-slash-here" },
    }).catch((error: unknown) => String(error));

    // A child that quietly ran on the parent's model would make the cross-model rule a lie.
    expect(String(failure)).toContain("provider/modelId");
    const children = (await getDesktopState(window)).orchestrationChildren;
    expect(children).toHaveLength(0);
  } finally {
    await harness.close();
  }
});

test("an unavailable model is refused with the model named, not inherited", async () => {
  test.setTimeout(90_000);
  const userDataDir = await makeUserDataDir();
  const agentDir = join(userDataDir, "agent");
  const workspacePath = await makeWorkspace("child-thread-model-unavailable");
  await seedAgentDir(agentDir, { withOpenAiAuth: false, withDefaultModel: false });
  await writeFile(
    join(agentDir, "settings.json"),
    JSON.stringify({
      defaultProvider: PARENT_PROVIDER,
      defaultModel: PARENT_MODEL_ID,
      enabledModels: [`${PARENT_PROVIDER}/${PARENT_MODEL_ID}`],
      packages: [],
      cacheWarming: "off",
      compaction: { enabled: false },
    }),
  );
  await writeProjectExtension(workspacePath, "models.ts", extensionSource);
  const harness = await launchDesktop(userDataDir, {
    agentDir,
    initialWorkspaces: [workspacePath],
    scrubProviderEnv: true,
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();
    await waitForWorkspaceByPath(window, workspacePath);
    await createNamedThread(window, "Parent refuses an unknown model");
    const parentRef = await selectedSessionRef(window);

    const failure = await runOrchestrationRuntimeTool(harness, {
      toolName: "create_child_thread",
      toolCallId: "child-unknown-model",
      sessionRef: parentRef,
      params: {
        prompt: "Do the work.",
        model: `${CHILD_PROVIDER}/does-not-exist`,
      },
    }).catch((error: unknown) => String(error));

    // Naming the model and the way to list real ones is what makes this fixable by the caller.
    expect(String(failure)).toContain(`requested model ${CHILD_PROVIDER}/does-not-exist`);
    expect(String(failure)).toContain("pi --list-models");
    // The message must not claim the model is the cause: creation can fail for other reasons.
    expect(String(failure)).not.toContain("is not available");
    expect((await getDesktopState(window)).orchestrationChildren).toHaveLength(0);
  } finally {
    await harness.close();
  }
});

test("replaying the same tool call reports the child's real model and refuses a switch", async () => {
  test.setTimeout(90_000);
  const userDataDir = await makeUserDataDir();
  const agentDir = join(userDataDir, "agent");
  const workspacePath = await makeWorkspace("child-thread-model-replay");
  await seedAgentDir(agentDir, { withOpenAiAuth: false, withDefaultModel: false });
  await writeFile(
    join(agentDir, "settings.json"),
    JSON.stringify({
      defaultProvider: PARENT_PROVIDER,
      defaultModel: PARENT_MODEL_ID,
      enabledModels: [
        `${PARENT_PROVIDER}/${PARENT_MODEL_ID}`,
        `${CHILD_PROVIDER}/${CHILD_MODEL_ID}`,
      ],
      packages: [],
      cacheWarming: "off",
      compaction: { enabled: false },
    }),
  );
  await writeProjectExtension(workspacePath, "models.ts", extensionSource);
  const harness = await launchDesktop(userDataDir, {
    agentDir,
    initialWorkspaces: [workspacePath],
    scrubProviderEnv: true,
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();
    await waitForWorkspaceByPath(window, workspacePath);
    await createNamedThread(window, "Parent replays a child");
    const parentRef = await selectedSessionRef(window);
    const first = await runOrchestrationRuntimeTool(harness, {
      toolName: "create_child_thread",
      toolCallId: "replay-child",
      sessionRef: parentRef,
      params: { prompt: "Review it.", model: `${CHILD_PROVIDER}/${CHILD_MODEL_ID}` },
    });
    expect(first.details).toMatchObject({ model: `${CHILD_PROVIDER}/${CHILD_MODEL_ID}` });

    // Same call, no model given: the answer still reports what the child runs, not "unknown".
    const replay = await runOrchestrationRuntimeTool(harness, {
      toolName: "create_child_thread",
      toolCallId: "replay-child",
      sessionRef: parentRef,
      params: { prompt: "Review it." },
    });
    expect(replay.details).toMatchObject({ model: `${CHILD_PROVIDER}/${CHILD_MODEL_ID}` });

    // Same call asking for a different model cannot silently claim a switch it never made.
    const conflict = await runOrchestrationRuntimeTool(harness, {
      toolName: "create_child_thread",
      toolCallId: "replay-child",
      sessionRef: parentRef,
      params: { prompt: "Review it.", model: `${PARENT_PROVIDER}/${PARENT_MODEL_ID}` },
    }).catch((error: unknown) => String(error));
    expect(String(conflict)).toContain("cannot switch it to");

    // An unparseable model on the replay path is refused too, instead of reading as "not given".
    const malformed = await runOrchestrationRuntimeTool(harness, {
      toolName: "create_child_thread",
      toolCallId: "replay-child",
      sessionRef: parentRef,
      params: { prompt: "Review it.", model: "no-slash-here" },
    }).catch((error: unknown) => String(error));
    expect(String(malformed)).toContain("provider/modelId");
    // One child, still on the model it was created with.
    const children = (await getDesktopState(window)).orchestrationChildren;
    expect(children).toHaveLength(1);
  } finally {
    await harness.close();
  }
});
