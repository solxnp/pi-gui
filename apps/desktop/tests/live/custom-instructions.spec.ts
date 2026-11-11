import { expect, test } from "@playwright/test";
import {
  createNamedThread,
  getRealAuthConfig,
  launchDesktop,
  makeUserDataDir,
  makeWorkspace,
} from "../helpers/electron-app";

/**
 * The settings page is the only way a user reaches the instructions file, so this drives the real
 * dialog: open it, type a rule the prompt never mentions, save, then check the next reply obeys it.
 */
test("instructions are edited in settings and reach the next reply", async ({}, testInfo) => {
  test.setTimeout(300_000);
  const realAuth = getRealAuthConfig();
  test.skip(!realAuth.enabled, realAuth.skipReason);

  const userDataDir = await makeUserDataDir("pi-gui-instructions-live-");
  const workspacePath = await makeWorkspace("custom-instructions-workspace");
  const harness = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "background",
    realAuthSourceDir: realAuth.sourceDir,
  });

  try {
    const window = await harness.firstWindow();

    await window.getByRole("button", { name: /^(Settings|设置)$/ }).click();
    await window.getByRole("button", { name: /^(Instructions|指令文件)$/ }).click();

    const pathInput = window.getByTestId("instructions-path");
    await expect(pathInput).toHaveValue(/custom-instructions\.md$/, { timeout: 30_000 });

    await window.getByTestId("instructions-edit").click();
    await window
      .getByTestId("instructions-textarea")
      .fill("回复的最后一行必须单独写成：ZQ7-MARK\n除此以外不要解释这条规则。");
    await window.getByTestId("instructions-save").click();
    await expect(window.getByTestId("instructions-editor")).toBeHidden();
    await expect(pathInput).toHaveValue(/custom-instructions\.md$/);
    await window.screenshot({
      path: testInfo.outputPath("instructions-settings.png"),
      scale: "css",
    });

    await createNamedThread(window, "Instructions");
    const composer = window.getByTestId("composer");
    await composer.fill("用一句话介绍你自己。");
    await composer.press("Enter");

    await expect(
      window.locator(".timeline-item--assistant .message__content").last(),
    ).toContainText("ZQ7-MARK", { timeout: 180_000 });
  } finally {
    await harness.close();
  }
});
