import { expect, test } from "@playwright/test";
import {
  createNamedThread,
  getDesktopState,
  launchDesktop,
  makeUserDataDir,
  makeWorkspace,
} from "../helpers/electron-app";

const TARGET = "Tab menu target";
const OTHER = "Second tab";

function tabFor(window: import("@playwright/test").Page, title: string) {
  return window.getByTestId("thread-tabs").locator(".thread-tabs__tab", { hasText: title }).first();
}

/**
 * Closing a tab only hides it, so archiving used to mean going back to 「全部会话」 to find the
 * thread again. The tab's right-click menu offers the same action list as the sidebar row.
 */
test("a tab's right-click menu renames and archives that thread", async () => {
  test.setTimeout(120_000);
  const userDataDir = await makeUserDataDir();
  const workspacePath = await makeWorkspace("thread-tab-menu");
  const harness = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();
    await createNamedThread(window, TARGET);
    await createNamedThread(window, OTHER);

    const targetTab = tabFor(window, TARGET);
    await expect(targetTab).toBeVisible();
    const target = (await getDesktopState(window)).workspaces.flatMap((workspace) =>
      workspace.sessions
        .filter((session) => session.title === TARGET)
        .map((session) => ({ workspaceId: workspace.id, sessionId: session.id })),
    )[0];
    expect(target).toBeDefined();

    await targetTab.click({ button: "right" });
    const menu = window.locator(".thread-tabs__context-menu");
    await expect(menu).toBeVisible();
    await expect(menu.locator('[data-thread-action="rename-thread"]')).toBeVisible();
    const archiveItem = menu.locator('[data-thread-action="archive-thread"]');
    await expect(archiveItem).toBeVisible();

    await archiveItem.click();
    await expect(menu).toHaveCount(0);
    // Archiving takes the thread out of the strip and out of the sidebar's active list.
    await expect(tabFor(window, TARGET)).toHaveCount(0);
    await expect(tabFor(window, OTHER)).toBeVisible();
    await expect
      .poll(async () => {
        const state = await getDesktopState(window);
        return state.workspaces
          .find((workspace) => workspace.id === target!.workspaceId)
          ?.sessions.find((session) => session.id === target!.sessionId)?.archivedAt;
      })
      .toBeTruthy();

    // The same menu renames the tab in place, without sending the user to 「全部会话」.
    const otherTab = tabFor(window, OTHER);
    await otherTab.click({ button: "right" });
    await window.locator('[data-thread-action="rename-thread"]').click();
    const renameInput = window.locator(".thread-tabs__rename");
    await expect(renameInput).toBeVisible();
    await renameInput.fill("Renamed from tab");
    await renameInput.press("Enter");
    await expect(tabFor(window, "Renamed from tab")).toBeVisible();
    await expect(tabFor(window, OTHER)).toHaveCount(0);
    await expect(window.locator(".chat-header__title")).toHaveText("Renamed from tab");
  } finally {
    await harness.close();
  }
});
