import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import {
  createNamedThread,
  desktopShortcut,
  launchDesktop,
  makeUserDataDir,
  makeWorkspace,
  openNewThread,
  seedAgentDir,
  waitForWorkspaceByPath,
} from "../helpers/electron-app";

/**
 * A default model picked in Settings used to snap back to the previous one, and New thread kept
 * starting on that previous model. Cause: every workspace keeps its own SettingsManager holding
 * the global settings it read at startup, and the settings page writes through one workspace
 * while the refreshed state reads another (the selected one) — so the write was invisible until
 * a restart. Two workspaces with different ones current is what exposes it.
 */
test("the default model picked in settings sticks and New thread starts on it", async () => {
  test.setTimeout(120_000);

  const userDataDir = await makeUserDataDir();
  const agentDir = join(userDataDir, "agent");
  const workspaceA = await makeWorkspace("default-model-a");
  const workspaceB = await makeWorkspace("default-model-b");
  // Settings live on their own: gpt-5 is the seeded default, gpt-4o the model we switch to.
  await seedAgentDir(agentDir);

  const harness = await launchDesktop(userDataDir, {
    agentDir,
    initialWorkspaces: [workspaceA, workspaceB],
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();
    const rootWorkspaceB = await waitForWorkspaceByPath(window, workspaceB);
    // A thread in the second workspace, so the selected workspace is not the first root folder —
    // the settings surface falls back to the first one, which is the split that broke the read.
    await createNamedThread(window, "Second workspace thread", {
      workspaceName: rootWorkspaceB.name,
    });
    await expect(window.locator(".chat-header__title")).toHaveText("Second workspace thread");

    await openSettings(window);
    await window.getByRole("button", { name: "Models", exact: true }).click();
    const defaultSelect = window.getByLabel("Default model", { exact: true });
    await expect(defaultSelect).toHaveValue("openai:gpt-5");

    await defaultSelect.selectOption("openai:gpt-4o");
    await expect(defaultSelect).toHaveValue("openai:gpt-4o");

    await window.getByRole("button", { name: "Back to app", exact: true }).click();
    await openNewThread(window);
    // The consequence users see: the next thread started on the old default.
    await expect(window.locator(".new-thread__hint .model-selector__badge").first()).toHaveText(
      "openai:gpt-4o",
    );
  } finally {
    await harness.close();
  }
});

async function openSettings(window: Page): Promise<void> {
  await window.keyboard.press(desktopShortcut(","));
  await expect(window.getByTestId("settings-surface")).toBeVisible();
}
