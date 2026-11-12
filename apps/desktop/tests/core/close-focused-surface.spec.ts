import { expect, test } from "@playwright/test";
import {
  createNamedThread,
  desktopShortcut,
  launchDesktop,
  makeUserDataDir,
  makeWorkspace,
  selectSidePanel,
  type DesktopHarness,
} from "../helpers/electron-app";

async function pressCloseShortcut(harness: DesktopHarness): Promise<void> {
  const modifier = process.platform === "darwin" ? "meta" : "control";
  await harness.electronApp.evaluate(({ BrowserWindow }, keyModifier) => {
    BrowserWindow.getAllWindows()[0]?.webContents.sendInputEvent({
      type: "keyDown",
      keyCode: "w",
      modifiers: [keyModifier],
    });
  }, modifier);
}

test("Cmd/Ctrl+W closes the shown conversation's tab, not the side panel", async () => {
  test.setTimeout(60_000);
  const userDataDir = await makeUserDataDir();
  const workspacePath = await makeWorkspace("close-thread-tab");
  const harness = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();
    await createNamedThread(window, "First tab thread");
    await createNamedThread(window, "Second tab thread");
    const tabs = window.getByTestId("thread-tabs").getByRole("tab");
    await expect(tabs).toHaveText(["First tab thread", "Second tab thread"]);

    // A focused tool panel keeps its own tab: ⌘W still belongs to the conversation.
    await selectSidePanel(window, "Files");
    const files = window.getByTestId("file-workbench");
    await expect(files).toBeVisible();
    await files.locator(".file-workbench__tree-row--file").first().click();

    await pressCloseShortcut(harness);
    await expect(tabs).toHaveText(["First tab thread"]);
    await expect(window.locator(".chat-header__title")).toHaveText("First tab thread");
    // Switching to that thread shows its own tool layout; the Files tab was never
    // closed by the chord.
    await tabs.first().click();
    await expect(window.locator(".chat-header__title")).toHaveText("First tab thread");

    // The last tab goes away with the same chord and the window stays open.
    await pressCloseShortcut(harness);
    await expect(window.getByTestId("thread-tabs")).toHaveCount(0);
    await expect(window.getByTestId("new-thread-composer")).toBeVisible();
    await expect
      .poll(() =>
        harness.electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length),
      )
      .toBe(1);
  } finally {
    await harness.close();
  }
});

test("Cmd/Ctrl+1-9 follow the tab strip instead of the recency list", async () => {
  test.setTimeout(60_000);
  const userDataDir = await makeUserDataDir();
  const workspacePath = await makeWorkspace("thread-tab-shortcuts");
  const harness = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();
    await createNamedThread(window, "Alpha thread");
    await createNamedThread(window, "Beta thread");
    await createNamedThread(window, "Gamma thread");
    const tabs = window.getByTestId("thread-tabs").getByRole("tab");
    await expect(tabs).toHaveText(["Alpha thread", "Beta thread", "Gamma thread"]);

    await window.keyboard.press(desktopShortcut("1"));
    await expect(window.locator(".chat-header__title")).toHaveText("Alpha thread");
    // Beta is the second tab even though Gamma is the most recent conversation.
    await window.keyboard.press(desktopShortcut("2"));
    await expect(window.locator(".chat-header__title")).toHaveText("Beta thread");
    // A slot past the strip does nothing.
    await window.keyboard.press(desktopShortcut("9"));
    await expect(window.locator(".chat-header__title")).toHaveText("Beta thread");
  } finally {
    await harness.close();
  }
});
