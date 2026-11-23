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
  tickOrchestrationSupervision,
} from "../helpers/electron-app";
import { startHangingOpenAiServer } from "../helpers/hanging-openai-server";

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

/** A provider whose model answers instantly, so a child finishes on its own. */
const FAST_EXTENSION = String.raw`
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai";

export default function fast(pi) {
  pi.registerProvider("fast-child-test", {
    baseUrl: "http://127.0.0.1:9/never-contact",
    apiKey: "LOCAL_TEST_CANARY",
    api: "fast-child-test",
    models: [{
      id: "scripted",
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
        content: [{ type: "text", text: "CHILD DONE: reviewed 3 files" }],
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
        stream.push({ type: "text_delta", contentIndex: 0, delta: "CHILD DONE: reviewed 3 files", partial: done });
        stream.push({ type: "done", reason: "stop", message: done });
      });
      return stream;
    },
  });
}
`;

test("wait_for_children returns once the child finishes, without messaging the parent", async () => {
  test.setTimeout(120_000);
  const userDataDir = await makeUserDataDir();
  const agentDir = join(userDataDir, "agent");
  const workspacePath = await makeWorkspace("wait-for-children-fast");
  await seedAgentDir(agentDir, { withOpenAiAuth: false, withDefaultModel: false });
  await writeFile(
    join(agentDir, "settings.json"),
    JSON.stringify({
      defaultProvider: "fast-child-test",
      defaultModel: "scripted",
      enabledModels: ["fast-child-test/scripted"],
      packages: [],
      cacheWarming: "off",
      compaction: { enabled: false },
    }),
  );
  const { writeProjectExtension } = await import("../helpers/electron-app");
  await writeProjectExtension(workspacePath, "fast.ts", FAST_EXTENSION);
  const harness = await launchDesktop(userDataDir, {
    agentDir,
    initialWorkspaces: [workspacePath],
    scrubProviderEnv: true,
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();
    await createNamedThread(window, "Parent waits for a fast child");
    const parentRef = await selectedSessionRef(window);

    const created = await runOrchestrationRuntimeTool(harness, {
      toolName: "create_child_thread",
      toolCallId: "fast-child",
      sessionRef: parentRef,
      params: { prompt: "Review the change." },
    });
    const childThreadId = String(created.details?.childThreadId ?? "");
    expect(childThreadId).not.toBe("");

    const waited = await runOrchestrationRuntimeTool(harness, {
      toolName: "wait_for_children",
      toolCallId: "wait-1",
      sessionRef: parentRef,
      params: { thread_ids: [childThreadId], timeout_minutes: 2 },
    });

    expect(waited.details).toMatchObject({ timedOut: false });
    const children = waited.details?.children as readonly {
      readonly threadId: string;
      readonly status: string;
      readonly latest: string;
    }[];
    expect(children).toHaveLength(1);
    expect(children[0]?.threadId).toBe(childThreadId);
    expect(children[0]?.status).toBe("complete");
    // The parent gets the child's own last line, so it never has to ask.
    expect(children[0]?.latest).toContain("CHILD DONE");

    // The wait itself must not write into the parent's conversation: that is the user's thread.
    // Nothing was queued for the parent, and nothing was appended to its transcript.
    const state = await getDesktopState(window);
    expect(state.queuedComposerMessages).toHaveLength(0);
    const parentText = await window.getByTestId("transcript").innerText();
    expect(parentText).not.toContain("子会话完成");
    expect(parentText).not.toContain("waiting for");
  } finally {
    await harness.close();
  }
});

test("wait_for_children returns on its deadline with the child still running", async () => {
  test.setTimeout(120_000);
  const server = await startHangingOpenAiServer();
  const userDataDir = await makeUserDataDir();
  const agentDir = join(userDataDir, "agent");
  const workspacePath = await makeWorkspace("wait-for-children-timeout");
  await seedAgentDir(agentDir, {
    withOpenAiAuth: false,
    withDefaultModel: false,
    enabledModels: ["slow-test/slow"],
  });
  await writeFile(
    join(agentDir, "settings.json"),
    JSON.stringify({
      defaultProvider: "slow-test",
      defaultModel: "slow",
      enabledModels: ["slow-test/slow"],
      packages: [],
      cacheWarming: "off",
      compaction: { enabled: false },
    }),
  );
  await writeFile(
    join(agentDir, "models.json"),
    `${JSON.stringify(
      {
        providers: {
          "slow-test": {
            baseUrl: server.baseUrl,
            api: "openai-completions",
            apiKey: "unused",
            models: [{ id: "slow" }],
          },
        },
      },
      null,
      2,
    )}\n`,
  );
  const harness = await launchDesktop(userDataDir, {
    agentDir,
    initialWorkspaces: [workspacePath],
    scrubProviderEnv: true,
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();
    await createNamedThread(window, "Parent times out waiting");
    const parentRef = await selectedSessionRef(window);

    const created = await runOrchestrationRuntimeTool(harness, {
      toolName: "create_child_thread",
      toolCallId: "slow-child",
      sessionRef: parentRef,
      params: { prompt: "Keep working and never answer." },
    });
    const childThreadId = String(created.details?.childThreadId ?? "");

    // A deadline shorter than the child needs: the wait must come back, not hang the turn.
    const waited = await runOrchestrationRuntimeTool(harness, {
      toolName: "wait_for_children",
      toolCallId: "wait-timeout",
      sessionRef: parentRef,
      params: { thread_ids: [childThreadId], timeout_minutes: 0.05 },
    });

    expect(waited.details).toMatchObject({ timedOut: true });
    const children = waited.details?.children as readonly { readonly status: string }[];
    expect(children[0]?.status).toBe("running");
    expect(Number(waited.details?.waitedMs)).toBeGreaterThan(0);
  } finally {
    await harness.close();
  }
});

test("a finished child wakes a parent whose turn is already gone", async () => {
  test.setTimeout(120_000);
  // The app wakes an idle parent on a supervision tick; a production tick is a minute long.
  const userDataDir = await makeUserDataDir();
  const agentDir = join(userDataDir, "agent");
  const workspacePath = await makeWorkspace("wait-for-children-wake");
  await seedAgentDir(agentDir, { withOpenAiAuth: false, withDefaultModel: false });
  await writeFile(
    join(agentDir, "settings.json"),
    JSON.stringify({
      defaultProvider: "fast-child-test",
      defaultModel: "scripted",
      enabledModels: ["fast-child-test/scripted"],
      packages: [],
      cacheWarming: "off",
      compaction: { enabled: false },
    }),
  );
  const { writeProjectExtension } = await import("../helpers/electron-app");
  await writeProjectExtension(workspacePath, "fast.ts", FAST_EXTENSION);
  const harness = await launchDesktop(userDataDir, {
    agentDir,
    initialWorkspaces: [workspacePath],
    scrubProviderEnv: true,
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();
    await createNamedThread(window, "Parent that will be woken");
    const parentRef = await selectedSessionRef(window);

    // No wait call here on purpose: this is the crash case, where the parent's turn is gone.
    await runOrchestrationRuntimeTool(harness, {
      toolName: "create_child_thread",
      toolCallId: "wake-child",
      sessionRef: parentRef,
      params: { prompt: "Review the change." },
    });

    // The child finishes on its own; then one supervision tick is what a real app runs a minute
    // later. Driving it here keeps the test deterministic instead of sleeping out the interval.
    await expect
      .poll(
        async () => {
          const state = await getDesktopState(window);
          return state.orchestrationChildren[0]?.status;
        },
        { timeout: 30_000 },
      )
      .toBe("complete");
    await tickOrchestrationSupervision(harness);
    await tickOrchestrationSupervision(harness);

    const transcript = window.getByTestId("transcript");
    await expect(transcript).toContainText("子会话完成", { timeout: 30_000 });
    // The notice names itself, so the user never mistakes it for something they typed.
    await expect(transcript).toContainText("不是用户输入");

    // Two ticks, one child: the wake happens once, not on every tick.
    const countWakes = async () => (await transcript.innerText()).split("子会话完成").length - 1;
    expect(await countWakes()).toBe(1);
  } finally {
    await harness.close();
  }
});
