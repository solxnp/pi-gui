import { copyFile, cp, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import {
  getDesktopState,
  getRealAuthConfig,
  launchDesktop,
  makeUserDataDir,
  makeWorkspace,
  openNewThread,
  waitForWorkspaceByPath,
} from "../helpers/electron-app";

/**
 * Real-provider proof that a new thread stops being called "New thread".
 *
 * The core lane can only prove this against a scripted endpoint. This spec runs the user's real
 * agent dir, so the title request goes to whatever the configured default model is — including a
 * default registered by an extension (a router such as `commandcode/auto`), which is the case the
 * placeholder used to stick on.
 */
test("renames a new thread using the configured default model", async () => {
  test.setTimeout(180_000);
  const realAuth = getRealAuthConfig();
  test.skip(!realAuth.enabled, realAuth.skipReason);

  const userDataDir = await makeUserDataDir();
  const workspacePath = await makeWorkspace("live-title-workspace");
  // The launcher's real-auth copy keeps only pi's own config files, but the configured default
  // model here is registered by an extension (a router provider). Copy those too, or the app
  // reports "Default model unavailable" and the title never has a model to ask.
  const agentDir = join(userDataDir, "agent");
  await mkdir(agentDir, { recursive: true });
  for (const file of ["auth.json", "settings.json", "models.json"]) {
    await copyFile(join(realAuth.sourceDir!, file), join(agentDir, file)).catch(() => undefined);
  }
  await cp(join(realAuth.sourceDir!, "extensions"), join(agentDir, "extensions"), {
    recursive: true,
  }).catch(() => undefined);
  const harness = await launchDesktop(userDataDir, {
    agentDir,
    initialWorkspaces: [workspacePath],
    testMode: "background",
    scrubProviderEnv: true,
  });

  try {
    const window = await harness.firstWindow();
    await waitForWorkspaceByPath(window, workspacePath);

    await openNewThread(window);
    await window
      .getByLabel("New thread prompt")
      .fill("Reply with only the uppercase word READY, then stop.");
    await window.getByRole("button", { name: "Start thread" }).click();

    /** Title of the thread this run created, read by its id rather than by list order. */
    const startedTitle = async (): Promise<string> => {
      const state = await getDesktopState(window);
      const workspace = state.workspaces.find((entry) => entry.id === state.selectedWorkspaceId);
      return (
        workspace?.sessions.find((session) => session.id === state.selectedSessionId)?.title ?? ""
      );
    };
    // A real title: not blank (the session may not be seeded yet) and not the placeholder.
    await expect
      .poll(startedTitle, { timeout: 150_000, intervals: [1_000] })
      .not.toMatch(/^(New thread)?$/);

    const title = await startedTitle();
    await expect(window.locator(".chat-header__title")).toHaveText(title);
  } finally {
    await harness.close();
  }
});
