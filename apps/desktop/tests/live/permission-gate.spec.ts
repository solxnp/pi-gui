import { expect, test } from "@playwright/test";
import {
  createNamedThread,
  getRealAuthConfig,
  launchDesktop,
  makeUserDataDir,
  makeWorkspace,
} from "../helpers/electron-app";

/**
 * The permission gate is a pi-gui built-in extension, so only a real tool call proves it is wired:
 * the dialog has to come from the running app, and a denial has to reach the tool result.
 */
test("a dangerous bash command asks first and the denial reaches the tool result", async () => {
  test.setTimeout(300_000);
  const realAuth = getRealAuthConfig();
  test.skip(!realAuth.enabled, realAuth.skipReason);

  const userDataDir = await makeUserDataDir();
  const workspacePath = await makeWorkspace("permission-gate-workspace");
  const harness = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "background",
    realAuthSourceDir: realAuth.sourceDir,
  });

  try {
    const window = await harness.firstWindow();
    await createNamedThread(window, "Permission gate");

    const composer = window.getByTestId("composer");
    await composer.fill(
      "Use the bash tool to run exactly this command in one call: rm -rf permission-gate-probe-dir. Do not change it. After the tool result, reply with one short sentence.",
    );
    await composer.press("Enter");

    const dialog = window.getByTestId("extension-dialog");
    await expect(dialog).toBeVisible({ timeout: 180_000 });
    await expect(dialog).toContainText("Confirm dangerous command");
    await expect(dialog).toContainText("rm-recursive-force");

    await window.getByTestId("extension-dialog-cancel").click();
    await expect(dialog).toBeHidden();

    const toolItem = window.locator(".timeline-tool").first();
    await expect(toolItem).toBeVisible({ timeout: 60_000 });
    await toolItem.locator(".timeline-tool__header").click();
    await expect(toolItem.locator(".timeline-tool__body")).toContainText("denied by the user");
  } finally {
    await harness.close();
  }
});
