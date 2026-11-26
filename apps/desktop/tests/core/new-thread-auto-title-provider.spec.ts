import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import {
  launchDesktop,
  makeUserDataDir,
  makeWorkspace,
  seedAgentDir,
  startThreadViaIpc,
  waitForSessionByTitle,
  waitForWorkspaceByPath,
  writeProjectExtension,
} from "../helpers/electron-app";
import {
  startScriptedOpenAiServer,
  type ScriptedChatRequest,
  type ScriptedReply,
} from "../helpers/scripted-openai-server";

const PROVIDER = "title-scripted";
const MODEL = "title-model";
const GENERATED_TITLE = "Scripted thread title";

/** The auto-title request, told apart from the conversation request by its system prompt. */
function isTitleRequest(request: ScriptedChatRequest): boolean {
  return request.messages.some((message) => message.role === "system" && /thread title/i.test(message.content));
}

function scriptProvider(request: ScriptedChatRequest): ScriptedReply {
  return isTitleRequest(request) ? { text: GENERATED_TITLE } : { text: "Working on it." };
}

/**
 * Auto-title must run against the workspace's own model runtime.
 *
 * The regression ("every new thread says New thread"): the generator built a bare runtime with
 * no extensions and asked it for the workspace default model. When that default is registered by
 * an extension — a router, a custom endpoint — it does not resolve there, so the request either
 * went to an unrelated provider (which failed on quota) or found no model at all. Here the
 * default provider is registered by a project extension and answers only on its own endpoint, so
 * the title appears only if the request really reached that provider.
 */
test("titles a new thread using the model an extension registered as the default", async () => {
  test.setTimeout(90_000);
  const userDataDir = await makeUserDataDir();
  const agentDir = join(userDataDir, "agent");
  const workspacePath = await makeWorkspace("auto-title-extension-provider-workspace");
  const server = await startScriptedOpenAiServer(scriptProvider);

  await seedAgentDir(agentDir, {
    withOpenAiAuth: false,
    withDefaultModel: false,
    enabledModels: [`${PROVIDER}/${MODEL}`],
  });
  await writeFile(
    join(agentDir, "settings.json"),
    JSON.stringify({
      defaultProvider: PROVIDER,
      defaultModel: MODEL,
      defaultThinkingLevel: "medium",
      enabledModels: [`${PROVIDER}/${MODEL}`],
    }),
  );
  await writeProjectExtension(
    workspacePath,
    "title-provider.ts",
    `export default function titleProviderExtension(pi) {
  pi.registerProvider(${JSON.stringify(PROVIDER)}, {
    baseUrl: ${JSON.stringify(server.baseUrl)},
    api: "openai-completions",
    apiKey: "unused",
    models: [
      {
        id: ${JSON.stringify(MODEL)},
        name: "Title Model",
        reasoning: false,
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 128000,
        maxTokens: 16384,
      },
    ],
  });
}
`,
  );

  const harness = await launchDesktop(userDataDir, {
    agentDir,
    initialWorkspaces: [workspacePath],
    scrubProviderEnv: true,
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();
    const workspace = await waitForWorkspaceByPath(window, workspacePath);

    await startThreadViaIpc(window, { prompt: "Rename the sessions drawer header" });

    await waitForSessionByTitle(window, workspace.id, GENERATED_TITLE);
    await expect(window.locator(".chat-header__title")).toHaveText(GENERATED_TITLE);
    await expect(window.getByTestId("thread-tabs")).not.toContainText("New thread");

    expect(server.requests.filter(isTitleRequest).length).toBe(1);
  } finally {
    await harness.close();
    await server.close();
  }
});
