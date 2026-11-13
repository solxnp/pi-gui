import { expect, test } from "@playwright/test";
import {
  createNamedThread,
  desktopShortcut,
  launchDesktop,
  makeUserDataDir,
  makeWorkspace,
  waitForWorkspaceByPath,
} from "../helpers/electron-app";

/**
 * The terminal must be reachable without remembering ⌘J, and hiding it must not
 * cost the user a running shell: the dock is a view over PTYs that live in main.
 */
test("opens the terminal from the topbar and hides it without closing its shells", async () => {
  test.setTimeout(120_000);

  const userDataDir = await makeUserDataDir();
  const workspacePath = await makeWorkspace("terminal-entry-points");
  const harness = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();
    await waitForWorkspaceByPath(window, workspacePath);
    await createNamedThread(window, "Terminal entry thread");

    const toggle = window.getByTestId("toggle-terminal");
    const dock = window.getByTestId("bottom-terminal");
    const terminal = window.getByTestId("integrated-terminal");

    // The dock starts hidden; the topbar button is the visible way in.
    await expect(dock).toHaveCount(0);
    await expect(toggle).toBeVisible();
    await expect(toggle).toHaveAttribute("aria-pressed", "false");
    await toggle.click();
    await expect(dock).toBeVisible();
    await expect(terminal).toBeVisible();
    await expect(toggle).toHaveAttribute("aria-pressed", "true");

    // Start output that finishes only after the dock is gone, so the marker can
    // only show up if the shell kept running while hidden.
    await terminal.locator(".xterm").click();
    await window.keyboard.type("sleep 6; echo PI_SURVIVES_HIDE");
    await window.keyboard.press("Enter");
    await expect(terminal.locator(".xterm-rows")).not.toContainText("PI_SURVIVES_HIDE");

    await toggle.click();
    await expect(dock).toHaveCount(0);
    await expect(toggle).toHaveAttribute("aria-pressed", "false");

    await window.waitForTimeout(7000);
    await toggle.click();
    await expect(dock).toBeVisible();
    await expect(terminal.locator(".xterm-rows")).toContainText("PI_SURVIVES_HIDE", {
      timeout: 20_000,
    });

    // The panel's own 收起 hides the dock the same way instead of closing the tab.
    await window.getByTestId("terminal-hide").click();
    await expect(dock).toHaveCount(0);
    await toggle.click();
    await expect(window.getByTestId("terminal-tab")).toHaveCount(1);
    await expect(terminal.locator(".xterm-rows")).toContainText("PI_SURVIVES_HIDE", {
      timeout: 20_000,
    });

    // The command palette lists it too, so ⌘K reaches the terminal as well.
    await toggle.click();
    await expect(dock).toHaveCount(0);
    await window.keyboard.press(desktopShortcut("K"));
    const palette = window.getByTestId("command-palette");
    await expect(palette).toBeVisible();
    await window.keyboard.type("toggle terminal");
    await expect(palette.getByRole("option").first()).toContainText("Toggle Terminal");
    await window.keyboard.press("Enter");
    await expect(palette).toHaveCount(0);
    await expect(dock).toBeVisible();
    await expect(window.getByTestId("terminal-tab")).toHaveCount(1);
  } finally {
    await harness.close();
  }
});
