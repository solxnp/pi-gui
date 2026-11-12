import { expect, test } from "@playwright/test";
import {
  createNamedThread,
  desktopShortcut,
  launchDesktop,
  makeUserDataDir,
  makeWorkspace,
} from "../helpers/electron-app";

test("Cmd/Ctrl+B toggles the conversation list, which is an overlay now", async () => {
  test.setTimeout(60_000);
  const userDataDir = await makeUserDataDir();
  const workspacePath = await makeWorkspace("thread-list-overlay");
  const harness = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();
    await createNamedThread(window, "Overlay thread");
    const overview = window.getByTestId("thread-overview");
    const composer = window.getByTestId("composer");

    // The list starts closed: no column, and the transcript has the full width.
    await expect(window.locator(".sidebar")).toHaveCount(0);
    await expect(overview).toHaveCount(0);
    const composerWidth = (await composer.boundingBox())?.width ?? 0;
    expect(composerWidth).toBeGreaterThan(600);

    await window.keyboard.press(desktopShortcut("B"));
    await expect(overview).toBeVisible();
    await expect(overview.locator(".session-row__select")).toContainText(["Overlay thread"]);

    // Opening a conversation from it closes the overlay again.
    await overview.locator(".session-row__select").first().click();
    await expect(overview).toHaveCount(0);
    await expect(window.locator(".chat-header__title")).toHaveText("Overlay thread");

    // Escape closes it without switching anything.
    await window.getByTestId("topbar-threads").click();
    await expect(overview).toBeVisible();
    await window.keyboard.press("Escape");
    await expect(overview).toHaveCount(0);
    await expect(composer).toBeVisible();
  } finally {
    await harness.close();
  }
});
