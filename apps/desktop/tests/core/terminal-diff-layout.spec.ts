import { expect, test } from "@playwright/test";
import {
  createNamedThread,
  launchDesktop,
  makeUserDataDir,
  makeWorkspace,
  selectSidePanel,
} from "../helpers/electron-app";

test("the terminal docks under the window while Review keeps the side panel", async () => {
  test.setTimeout(60_000);
  const userDataDir = await makeUserDataDir();
  const workspacePath = await makeWorkspace("terminal-diff-layout");
  const harness = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();
    await createNamedThread(window, "Terminal and Review layout");
    await selectSidePanel(window, "Review");
    const changes = window.locator(".diff-panel");
    await expect(changes).toBeVisible();

    await selectSidePanel(window, "Terminal");
    const terminal = window.getByTestId("integrated-terminal");
    await expect(terminal).toBeVisible();
    // Measure the panel again: the dock shortens `.main`, so the earlier box is stale.
    const changesBox = await changes.boundingBox();
    const terminalBox = await terminal.boundingBox();
    const composerBox = await window.getByTestId("composer").boundingBox();
    if (!changesBox || !terminalBox || !composerBox) {
      throw new Error("Expected visible tool, terminal and composer bounds");
    }
    // Full window width, under the composer, with the side panel ending above it.
    expect(terminalBox.x).toBeLessThan(2);
    expect(terminalBox.width).toBeGreaterThan(changesBox.width);
    expect(terminalBox.y).toBeGreaterThanOrEqual(composerBox.y + composerBox.height - 1);
    expect(changesBox.y + changesBox.height).toBeLessThanOrEqual(terminalBox.y + 1);
    await expect(changes).toBeVisible();

    await window.keyboard.press(process.platform === "darwin" ? "Meta+J" : "Control+J");
    await expect(terminal).toHaveCount(0);
    await expect(changes).toBeVisible();
    await expect(window.getByTestId("composer")).toBeVisible();
  } finally {
    await harness.close();
  }
});
