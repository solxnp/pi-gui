import { expect, test } from "@playwright/test";
import {
  createNamedThread,
  desktopShortcut,
  launchDesktop,
  makeUserDataDir,
  makeWorkspace,
  selectSidePanel,
} from "../helpers/electron-app";

test("one icon and keyboard shortcuts toggle the selected workspace tool", async () => {
  test.setTimeout(60_000);
  const userDataDir = await makeUserDataDir();
  const workspacePath = await makeWorkspace("workbench-shortcuts");
  const harness = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();
    await createNamedThread(window, "Shortcut thread");
    // A new conversation already opens the side panel with the three workflow
    // tools; the chooser is reached from the strip's own + button.
    const workbench = window.getByTestId("workbench");
    if (!(await workbench.isVisible())) {
      await window.getByTestId("toggle-side-panel").click();
    }
    await expect(workbench).toBeVisible();
    const toggle = window.getByTestId("toggle-side-panel");
    await expect(toggle).toHaveText("");
    const chooser = window.getByTestId("workbench-chooser");
    if (!(await chooser.isVisible())) await window.getByTestId("workbench-add-tab").click();
    const modifierLabel = process.platform === "darwin" ? "⌘" : "Ctrl+";
    const shiftPrefix = process.platform === "darwin" ? "⇧⌘" : "Ctrl+Shift+";
    const tile = (name: string) => chooser.getByRole("button", { name, exact: true });
    await expect(tile("Review").locator("kbd")).toHaveText(`${modifierLabel}R`);
    // The terminal left the rail for the bottom dock, so the chooser no longer lists it.
    await expect(tile("Terminal")).toHaveCount(0);
    // Apple puts the shift before the command symbol.
    await expect(tile("Files").locator("kbd")).toHaveText(`${shiftPrefix}O`);
    await expect(tile("Tasks").locator("kbd")).toHaveText(`${shiftPrefix}T`);
    await selectSidePanel(window, "Files");
    await expect(toggle).toHaveAttribute("aria-pressed", "true");

    await window.getByTestId("composer").click();
    await window.keyboard.press(desktopShortcut("Alt+B"));
    await expect(window.getByTestId("workbench")).toHaveCount(0);
    await expect(toggle).toHaveAttribute("aria-pressed", "false");
    await window.keyboard.press(desktopShortcut("Alt+B"));
    await expect(window.getByTestId("file-workbench")).toBeVisible();

    await selectSidePanel(window, "Review");
    await expect(window.locator(".diff-panel")).toBeVisible();
    await expect(window.getByTestId("file-workbench")).toHaveCount(0);
    await window.keyboard.press(desktopShortcut("R"));
    await expect(window.getByTestId("workbench")).toHaveCount(0);
    await window.keyboard.press(desktopShortcut("Alt+B"));
    await expect(window.locator(".diff-panel")).toBeVisible();

    // ⌘B opens the conversation list, which is an overlay now rather than a column.
    const overview = window.getByTestId("thread-overview");
    await expect(overview).toHaveCount(0);
    await window.keyboard.press(desktopShortcut("B"));
    await expect(overview).toBeVisible();
    await expect(window.locator(".diff-panel")).toBeVisible();
    await window.keyboard.press(desktopShortcut("B"));
    await expect(overview).toHaveCount(0);

    await window.keyboard.press(desktopShortcut("J"));
    const terminal = window.getByTestId("integrated-terminal");
    await expect(terminal).toBeVisible();
    await expect(window.locator(".diff-panel")).toHaveCount(0);
    await terminal.locator(".xterm").click();
    const modifier = process.platform === "darwin" ? "meta" : "control";
    const pressSidePanelShortcut = () =>
      harness.electronApp.evaluate(({ BrowserWindow }, keyModifier) => {
        BrowserWindow.getAllWindows()[0]?.webContents.sendInputEvent({
          type: "keyDown",
          keyCode: "b",
          modifiers: [keyModifier, "alt"],
        });
      }, modifier);
    await pressSidePanelShortcut();
    await expect(window.getByTestId("workbench")).toHaveCount(0);
    await pressSidePanelShortcut();
    await expect(terminal).toBeVisible();
    await expect(
      window.getByRole("tablist", { name: "Workspace tools" }).getByRole("tab"),
    ).toHaveCount(3);

    // Cmd+R reaches Review from the terminal on macOS; Ctrl+R stays with the shell elsewhere.
    await terminal.locator(".xterm").click();
    await harness.electronApp.evaluate(({ BrowserWindow }, keyModifier) => {
      BrowserWindow.getAllWindows()[0]?.webContents.sendInputEvent({
        type: "keyDown",
        keyCode: "r",
        modifiers: [keyModifier],
      });
    }, modifier);
    if (process.platform === "darwin") {
      await expect(window.locator(".diff-panel")).toBeVisible();
    } else {
      await expect(terminal.locator(".xterm-rows")).toContainText(/i-search/);
      await expect(window.locator(".diff-panel")).toHaveCount(0);
    }
  } finally {
    await harness.close();
  }
});

test("Shift+Cmd+O and Shift+Cmd+T toggle project files and the task manager", async () => {
  test.setTimeout(60_000);
  const userDataDir = await makeUserDataDir();
  const workspacePath = await makeWorkspace("workbench-tool-chords");
  const harness = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();
    await createNamedThread(window, "Tool chord thread");
    // The chords sit on Shift so plain Command+O stays Open Folder and Command+T
    // keeps opening the tab chooser.
    await window.getByTestId("composer").click();
    await window.keyboard.press(desktopShortcut("Shift+O"));
    await expect(window.getByTestId("file-workbench")).toBeVisible();
    await window.keyboard.press(desktopShortcut("Shift+T"));
    await expect(window.getByTestId("tasks-board")).toBeVisible();
    // A second press closes the panel the same way Review's chord does.
    await window.keyboard.press(desktopShortcut("Shift+T"));
    await expect(window.getByTestId("workbench")).toHaveCount(0);
  } finally {
    await harness.close();
  }
});
