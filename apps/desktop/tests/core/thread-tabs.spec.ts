import { expect, test, type Page } from "@playwright/test";
import {
  createNamedThread,
  createSessionViaIpc,
  launchDesktop,
  makeUserDataDir,
  makeWorkspace,
  openThreadOverview,
} from "../helpers/electron-app";

function tabsOf(window: Page) {
  return window.getByTestId("thread-tabs").getByRole("tab");
}

test("opened conversations become tabs, close from the strip, and survive a restart", async () => {
  test.setTimeout(90_000);
  const userDataDir = await makeUserDataDir();
  const workspacePath = await makeWorkspace("thread-tabs-shell");
  const launch = () =>
    launchDesktop(userDataDir, { initialWorkspaces: [workspacePath], testMode: "background" });

  const firstRun = await launch();
  try {
    const window = await firstRun.firstWindow();
    await createNamedThread(window, "Alpha thread");
    await createNamedThread(window, "Beta thread");
    await createNamedThread(window, "Gamma thread");
    // createNamedThread selects each new conversation, so all three are open.
    await expect(tabsOf(window)).toHaveText(["Alpha thread", "Beta thread", "Gamma thread"]);
    await expect(tabsOf(window).last()).toHaveAttribute("aria-selected", "true");

    // Closing from the strip leaves the conversation in the list but out of the tabs.
    await window
      .getByTestId("thread-tabs")
      .getByRole("button", { name: "Close Beta thread" })
      .click();
    await expect(tabsOf(window)).toHaveText(["Alpha thread", "Gamma thread"]);
    const overview = await openThreadOverview(window);
    await expect(
      overview.locator(".session-row__select", { hasText: "Beta thread" }),
    ).toBeVisible();
    await window.keyboard.press("Escape");

    // Re-opening it puts the tab back at the end of the strip.
    await window.getByTestId("topbar-threads").click();
    await window
      .getByTestId("thread-overview")
      .locator(".session-row__select", { hasText: "Beta thread" })
      .click();
    await expect(tabsOf(window)).toHaveText(["Alpha thread", "Gamma thread", "Beta thread"]);
  } finally {
    await firstRun.close();
  }

  const secondRun = await launch();
  try {
    const window = await secondRun.firstWindow();
    await expect(tabsOf(window)).toHaveText(["Alpha thread", "Gamma thread", "Beta thread"]);
    await expect(window.locator(".chat-header__title")).toHaveText("Beta thread");
  } finally {
    await secondRun.close();
  }
});

test("the strip wraps into at most three rows and scrolls the shown tab into view", async () => {
  test.setTimeout(90_000);
  const userDataDir = await makeUserDataDir();
  const workspacePath = await makeWorkspace("thread-tabs-rows");
  const harness = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();
    await createNamedThread(window, "First thread");
    for (let index = 1; index <= 11; index += 1) {
      // Every created conversation is selected, so each one opens its own tab.
      await createSessionViaIpc(window, workspacePath, `Filler thread ${index}`);
    }
    await expect(tabsOf(window)).toHaveCount(12);
    const strip = window.getByTestId("thread-tabs");
    // Three 32px rows plus gaps and padding; anything taller would push the
    // transcript down, which is what the row cap exists to prevent.
    const height = (await strip.boundingBox())?.height ?? 0;
    expect(height).toBeLessThanOrEqual(3 * 32 + 2 * 4 + 6 + 1);
    expect(height).toBeGreaterThan(32);
    // The shown tab stays visible even when the strip is wider than the window.
    await expect(tabsOf(window).last()).toBeInViewport();
  } finally {
    await harness.close();
  }
});
