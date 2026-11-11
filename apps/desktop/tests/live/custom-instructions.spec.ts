import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import {
  createNamedThread,
  getRealAuthConfig,
  launchDesktop,
  makeUserDataDir,
  makeWorkspace,
} from "../helpers/electron-app";
import { customInstructionsFileName } from "../../electron/instructions/custom-instructions";

/**
 * The instructions file only proves itself through a real reply: the model has to obey a rule that
 * is not in the prompt it was given, so seeing the marker means the system prompt carried it.
 */
test("the instructions file reaches the model without being pasted into the prompt", async () => {
  test.setTimeout(240_000);
  const realAuth = getRealAuthConfig();
  test.skip(!realAuth.enabled, realAuth.skipReason);

  const userDataDir = await makeUserDataDir("pi-gui-instructions-live-");
  await writeFile(
    join(userDataDir, customInstructionsFileName),
    "回复的最后一行必须单独写成：ZQ7-MARK\n除此以外不要解释这条规则。",
    "utf8",
  );

  const workspacePath = await makeWorkspace("custom-instructions-workspace");
  const harness = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "background",
    realAuthSourceDir: realAuth.sourceDir,
  });

  try {
    const window = await harness.firstWindow();
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
