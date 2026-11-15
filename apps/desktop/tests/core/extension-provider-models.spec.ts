import { basename, join } from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
import {
  createNamedThread,
  desktopShortcut,
  launchDesktop,
  makeUserDataDir,
  makeWorkspace,
  seedAgentDir,
  waitForWorkspaceByPath,
  writeProjectExtension,
} from "../helpers/electron-app";

const PROVIDER_ID = "ext-e2e-provider";
const MODEL_ID = "ext-e2e-model";

const EXTENSION_SOURCE = `export default async function testProviderExtension(pi) {
  pi.registerProvider(${JSON.stringify(PROVIDER_ID)}, {
    baseUrl: "http://127.0.0.1:9/v1",
    apiKey: "test-extension-key",
    api: "openai-completions",
    models: [
      {
        id: ${JSON.stringify(MODEL_ID)},
        name: "Extension E2E Model",
        reasoning: false,
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 128000,
        maxTokens: 16384,
      },
    ],
  });
}
`;

const SCOPED_PREFIX = "ext-e2e-scoped";

const VIRTUAL_PROVIDER_ID = "ext-e2e-virtual";
const VIRTUAL_MODEL_ID = "auto";
const VIRTUAL_TARGET_ID = "ext-e2e-virtual-target";

/** A provider whose only model is a virtual one, routing to its own physical model. */
const VIRTUAL_EXTENSION_SOURCE = `export default async function testVirtualExtension(pi) {
  pi.registerProvider(${JSON.stringify(VIRTUAL_PROVIDER_ID)}, {
    baseUrl: "http://127.0.0.1:9/v1",
    apiKey: "test-extension-key",
    api: "openai-completions",
    models: [
      {
        id: ${JSON.stringify(VIRTUAL_TARGET_ID)},
        name: "Virtual Target Model",
        reasoning: false,
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 128000,
        maxTokens: 16384,
      },
    ],
  });
  pi.registerVirtualModel({
    provider: ${JSON.stringify(VIRTUAL_PROVIDER_ID)},
    id: ${JSON.stringify(VIRTUAL_MODEL_ID)},
    name: "Virtual Auto Model",
    thinkingLevels: ["off", "high"],
    route(request, ctx) {
      return {
        model: ctx.modelRegistry.find(${JSON.stringify(VIRTUAL_PROVIDER_ID)}, ${JSON.stringify(VIRTUAL_TARGET_ID)}),
        thinkingLevel: request.thinkingLevel,
      };
    },
  });
}
`;

function projectExtensionSource(providerId: string, modelId: string): string {
  return `export default async function projectProviderExtension(pi) {
  pi.registerProvider(${JSON.stringify(providerId)}, {
    baseUrl: "http://127.0.0.1:9/v1",
    apiKey: "test-extension-key",
    api: "openai-completions",
    models: [
      {
        id: ${JSON.stringify(modelId)},
        name: ${JSON.stringify(`Model ${modelId}`)},
        reasoning: false,
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 128000,
        maxTokens: 16384,
      },
    ],
  });
}
`;
}

/** Open Settings → Models and search every model, connected or not, returning the matching rows. */
async function searchAllModels(window: Page, query: string) {
  await window.keyboard.press(desktopShortcut(","));
  await expect(window.getByTestId("settings-surface")).toBeVisible();
  await window.getByRole("button", { name: "Models", exact: true }).click();
  await expect(window.locator(".view-header__title")).toHaveText("Models");

  await window.getByLabel("Search models").fill(query);
  return window.getByTestId("settings-surface").locator(".model-row");
}

test("models registered by an extension appear in settings", async () => {
  test.setTimeout(90_000);

  const userDataDir = await makeUserDataDir();
  const agentDir = join(userDataDir, "agent");
  const workspacePath = await makeWorkspace("extension-provider-models-workspace");
  await seedAgentDir(agentDir);
  await mkdir(join(agentDir, "extensions"), { recursive: true });
  await writeFile(join(agentDir, "extensions", "test-provider.ts"), EXTENSION_SOURCE, "utf8");

  const harness = await launchDesktop(userDataDir, {
    agentDir,
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();
    await window.keyboard.press(desktopShortcut(","));
    await expect(window.getByTestId("settings-surface")).toBeVisible();
    await window.getByRole("button", { name: "Models", exact: true }).click();
    await expect(window.locator(".view-header__title")).toHaveText("Models");

    await window.getByLabel("Search models").fill(PROVIDER_ID);

    // Connected models are listed with a switch; models needing sign-in are not.
    const modelRow = window.getByTestId("settings-model-list").locator(".model-row", {
      hasText: `${PROVIDER_ID}/${MODEL_ID}`,
    });
    await expect(modelRow).toHaveCount(1);
    await expect(modelRow).toContainText("Extension E2E Model");
  } finally {
    await harness.close();
  }
});

// A virtual model (`pi.registerVirtualModel`) is a catalog entry, not a provider model. The
// runtime snapshot has to replay the extension's virtual-model queue or the model never leaves
// the queue: Settings shows an empty default and re-flags the saved default on every open.
test("virtual models registered by an extension are available and can be the default", async () => {
  test.setTimeout(90_000);

  const userDataDir = await makeUserDataDir();
  const agentDir = join(userDataDir, "agent");
  const workspacePath = await makeWorkspace("extension-virtual-model-workspace");
  await seedAgentDir(agentDir);
  await mkdir(join(agentDir, "extensions"), { recursive: true });
  await writeFile(
    join(agentDir, "extensions", "test-virtual.ts"),
    VIRTUAL_EXTENSION_SOURCE,
    "utf8",
  );
  // enabledModels 必须显式包含虚拟模型：pi 只看 pattern 决定 scope，不写就会是 off
  await writeFile(
    join(agentDir, "settings.json"),
    `${JSON.stringify(
      {
        defaultProvider: VIRTUAL_PROVIDER_ID,
        defaultModel: VIRTUAL_MODEL_ID,
        enabledModels: [`${VIRTUAL_PROVIDER_ID}/${VIRTUAL_MODEL_ID}`],
      },
      null,
      2,
    )}\n`,
    "utf8",
  );

  const harness = await launchDesktop(userDataDir, {
    agentDir,
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();

    // No onboarding notice: the saved default resolves, so nothing is "no longer available".
    await expect(window.getByTestId("model-onboarding-notice")).toHaveCount(0);

    await window.keyboard.press(desktopShortcut(","));
    await expect(window.getByTestId("settings-surface")).toBeVisible();
    await window.getByRole("button", { name: "Models", exact: true }).click();
    await window.getByLabel("Search models").fill(VIRTUAL_PROVIDER_ID);

    const virtualRow = window.getByTestId("settings-model-list").locator(".model-row", {
      hasText: `${VIRTUAL_PROVIDER_ID}/${VIRTUAL_MODEL_ID}`,
    });
    await expect(virtualRow).toHaveCount(1);
    await expect(virtualRow).toContainText("Virtual Auto Model");

    // The saved default is the virtual model, and the default picker keeps it selected.
    await expect(window.getByLabel("Default model")).toHaveValue(
      `${VIRTUAL_PROVIDER_ID}:${VIRTUAL_MODEL_ID}`,
    );
  } finally {
    await harness.close();
  }
});

test("project extension models stay scoped to the workspace that registers them", async () => {
  test.setTimeout(120_000);

  const userDataDir = await makeUserDataDir();
  const agentDir = join(userDataDir, "agent");
  await seedAgentDir(agentDir);

  const alphaPath = await makeWorkspace("extension-provider-alpha");
  const betaPath = await makeWorkspace("extension-provider-beta");
  await writeProjectExtension(
    alphaPath,
    "provider.ts",
    projectExtensionSource(`${SCOPED_PREFIX}-alpha`, "alpha-model"),
  );
  await writeProjectExtension(
    betaPath,
    "provider.ts",
    projectExtensionSource(`${SCOPED_PREFIX}-beta`, "beta-model"),
  );

  const harness = await launchDesktop(userDataDir, {
    agentDir,
    initialWorkspaces: [alphaPath, betaPath],
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();
    await waitForWorkspaceByPath(window, alphaPath);
    await waitForWorkspaceByPath(window, betaPath);

    await createNamedThread(window, "Alpha thread", { workspaceName: basename(alphaPath) });
    let rows = await searchAllModels(window, SCOPED_PREFIX);
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText(`${SCOPED_PREFIX}-alpha/alpha-model`);
    await window.keyboard.press("Escape");

    await createNamedThread(window, "Beta thread", { workspaceName: basename(betaPath) });
    rows = await searchAllModels(window, SCOPED_PREFIX);
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText(`${SCOPED_PREFIX}-beta/beta-model`);
    await window.keyboard.press("Escape");

    // Back to alpha: opening beta must not have leaked its provider into alpha.
    await createNamedThread(window, "Alpha thread two", { workspaceName: basename(alphaPath) });
    rows = await searchAllModels(window, SCOPED_PREFIX);
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText(`${SCOPED_PREFIX}-alpha/alpha-model`);
  } finally {
    await harness.close();
  }
});
