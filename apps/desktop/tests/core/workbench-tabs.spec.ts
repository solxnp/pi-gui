import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test, type Page, type TestInfo } from "@playwright/test";
import {
  commitAllInGitRepo,
  desktopShortcut,
  getDesktopState,
  initGitRepo,
  launchDesktop,
  makeUserDataDir,
  makeWorkspace,
  seedAgentDir,
  seedNamedTextSessionFixture,
  selectSession,
  selectSidePanel,
  waitForTimelineLayout,
  type DesktopHarness,
} from "../helpers/electron-app";

const TASK_A = "Workbench task A";
const TASK_B = "Workbench task B";
type ToolName = "Files" | "Review" | "Terminal";

// Real Pi history is fixture setup. All workspace, task, tab, and draft changes
// below use the visible app, with no provider requests or injected runtime events.
async function prepareWorkspace() {
  const userDataDir = await makeUserDataDir();
  const agentDir = join(userDataDir, "agent");
  const workspacePath = await makeWorkspace("workbench-tabs");
  await writeFile(join(workspacePath, "alpha.txt"), "Alpha document\nAlpha target line\n");
  await writeFile(join(workspacePath, "beta.txt"), "Beta document\nBeta target line\n");
  await initGitRepo(workspacePath);
  await commitAllInGitRepo(workspacePath, "Workbench fixture");
  await writeFile(
    join(workspacePath, "alpha.txt"),
    "Alpha document\nAlpha target line\nUncommitted workspace edit\n",
  );
  await seedAgentDir(agentDir, { withOpenAiAuth: false });
  for (const [title, file] of [
    [TASK_A, "alpha.txt"],
    [TASK_B, "beta.txt"],
  ] as const) {
    await seedNamedTextSessionFixture(agentDir, workspacePath, {
      title,
      userText: `Inspect ${file}`,
      assistantText: `Open ${file}:2 for the result.`,
    });
  }
  return { userDataDir, agentDir, workspacePath };
}

async function expectActiveTool(window: Page, name: ToolName): Promise<void> {
  await expect(window.getByTestId("workbench")).toBeVisible();
  await expect(
    window.getByRole("tablist", { name: "Workspace tools" }).getByRole("tab", {
      name,
      exact: true,
    }),
  ).toHaveAttribute("aria-selected", "true");
}

/** Tasks without a saved layout start with the workbench hidden. */
async function openWorkbench(window: Page): Promise<void> {
  const workbench = window.getByTestId("workbench");
  if (!(await workbench.isVisible())) await window.getByTestId("toggle-side-panel").click();
  await expect(workbench).toBeVisible();
}

async function addTool(window: Page, name: ToolName): Promise<void> {
  await openWorkbench(window);
  await window.getByTestId("workbench-add-tab").click();
  const chooser = window.getByTestId("workbench-chooser");
  await expect(chooser).toBeVisible();
  await chooser.getByRole("button", { name, exact: true }).click();
  await expectActiveTool(window, name);
}

async function openSecondWindow(harness: DesktopHarness): Promise<Page> {
  const existing = new Set(harness.electronApp.windows());
  // The app's native New Window shortcut is handled in before-input-event.
  await harness.electronApp.evaluate(
    ({ BrowserWindow }, modifier) => {
      BrowserWindow.getAllWindows()[0]?.webContents.sendInputEvent({
        type: "keyDown",
        keyCode: "n",
        modifiers: [modifier, "shift"],
      });
    },
    process.platform === "darwin" ? "meta" : "control",
  );
  await expect.poll(() => harness.electronApp.windows().length).toBe(existing.size + 1);
  const opened = harness.electronApp.windows().find((candidate) => !existing.has(candidate));
  if (!opened) throw new Error("Expected New Window to create a second desktop window");
  await opened.waitForLoadState("domcontentloaded");
  return opened;
}

async function captureToolWidths(
  harness: DesktopHarness,
  window: Page,
  testInfo: TestInfo,
  tool: ToolName,
): Promise<void> {
  for (const width of [1280, 1040]) {
    await harness.electronApp.evaluate(({ BrowserWindow }, nextWidth) => {
      BrowserWindow.getAllWindows()[0]?.setContentSize(nextWidth, 900);
    }, width);
    await expect.poll(() => window.evaluate(() => globalThis.window.innerWidth)).toBe(width);
    await expectActiveTool(window, tool);
    await expect(window.getByTestId("composer")).toBeVisible();
    const path = testInfo.outputPath(`${tool.toLowerCase()}-${width}.png`);
    await window.screenshot({ path, animations: "disabled" });
    await testInfo.attach(`${tool} at ${width}px`, { path, contentType: "image/png" });
  }
}

test("opens the three workflow tools, keeps them singleton, and closes to a neighbour", async () => {
  test.setTimeout(60_000);
  const fixture = await prepareWorkspace();
  const harness = await launchDesktop(fixture.userDataDir, {
    agentDir: fixture.agentDir,
    initialWorkspaces: [fixture.workspacePath],
    testMode: "background",
  });
  try {
    const window = await harness.firstWindow();
    await selectSession(window, TASK_A);
    const tabs = window.getByRole("tablist", { name: "Workspace tools" }).getByRole("tab");
    // A conversation opens the panels this workflow lives in.
    await expect(tabs).toHaveText(["Tasks", "Files", "Review"]);
    await expectActiveTool(window, "Tasks");

    await window.getByRole("tab", { name: "Files", exact: true }).click();
    await expectActiveTool(window, "Files");
    await window.locator('.file-workbench__tree-row--file[data-file-path="alpha.txt"]').click();
    await expect(window.getByTestId("file-workbench-preview")).toContainText("Alpha target line");

    // Opening a tool that is already open only focuses it.
    await addTool(window, "Files");
    await expect(tabs).toHaveText(["Tasks", "Files", "Review"]);

    await addTool(window, "Review");
    await window
      .locator('.diff-panel__file[data-file-path="alpha.txt"] .diff-panel__file-name')
      .click();
    await expect(
      window.getByRole("region", { name: "Diff", exact: true }).locator(".diff-inline"),
    ).toContainText("Uncommitted workspace edit");

    await window.getByRole("button", { name: "Close Review tab", exact: true }).click();
    await expectActiveTool(window, "Files");
    await window.getByRole("button", { name: "Close Files tab", exact: true }).click();
    await expectActiveTool(window, "Tasks");
    await window.getByRole("button", { name: "Close Tasks tab", exact: true }).click();
    await expect(window.getByTestId("workbench-chooser")).toBeVisible();
    await expect(tabs).toHaveCount(0);
  } finally {
    await harness.close();
  }
});

test("Cmd/Ctrl+T opens the add-tab chooser over the transcript", async () => {
  test.setTimeout(60_000);
  const fixture = await prepareWorkspace();
  const harness = await launchDesktop(fixture.userDataDir, {
    agentDir: fixture.agentDir,
    initialWorkspaces: [fixture.workspacePath],
    testMode: "background",
  });
  const pressNewTab = () =>
    harness.electronApp.evaluate(
      ({ BrowserWindow }, modifier) => {
        BrowserWindow.getAllWindows()[0]?.webContents.sendInputEvent({
          type: "keyDown",
          keyCode: "t",
          modifiers: [modifier],
        });
      },
      process.platform === "darwin" ? ("meta" as const) : ("control" as const),
    );
  try {
    const window = await harness.firstWindow();
    await selectSession(window, TASK_A);
    const chooser = window.getByTestId("workbench-chooser");

    await window.getByTestId("composer").click();
    await pressNewTab();
    await expect(chooser).toBeVisible();
    // The terminal moved to the bottom dock, so the chooser no longer lists it.
    await expect(chooser.getByRole("button", { name: "Terminal", exact: true })).toHaveCount(0);
    await chooser.getByRole("button", { name: "Files", exact: true }).click();
    await expectActiveTool(window, "Files");
  } finally {
    await harness.close();
  }
});

test("restores the window's tab set across a restart", async () => {
  test.setTimeout(90_000);
  const fixture = await prepareWorkspace();
  const launch = () =>
    launchDesktop(fixture.userDataDir, {
      agentDir: fixture.agentDir,
      initialWorkspaces: [fixture.workspacePath],
      testMode: "background",
    });

  const firstRun = await launch();
  try {
    const window = await firstRun.firstWindow();
    await selectSession(window, TASK_A);
    await addTool(window, "Files");
    await expectActiveTool(window, "Files");

    // Switching conversations keeps the window's tool set.
    await selectSession(window, TASK_B);
    await expect(window.getByTestId("workbench")).toBeVisible();
    await window.getByRole("button", { name: "Close Files tab", exact: true }).click();
    await expectActiveTool(window, "Tasks");
  } finally {
    await firstRun.close();
  }

  const secondRun = await launch();
  try {
    const window = await secondRun.firstWindow();
    await selectSession(window, TASK_B);
    await expect(
      window.getByRole("tablist", { name: "Workspace tools" }).getByRole("tab"),
    ).toHaveText(["Tasks", "Review"]);
  } finally {
    await secondRun.close();
  }
});

test("an invalid saved layout does not block the rest of the UI state", async () => {
  test.setTimeout(90_000);
  const fixture = await prepareWorkspace();
  const uiStatePath = join(fixture.userDataDir, "ui-state.json");
  await writeFile(
    uiStatePath,
    JSON.stringify({
      version: 20,
      composerDraftsBySession: {},
      taskWorkbenchTemplatesBySession: {
        [`${fixture.workspacePath}:${TASK_A}`]: { tools: "not-a-list", visibility: "visible" },
      },
    }),
  );
  const harness = await launchDesktop(fixture.userDataDir, {
    agentDir: fixture.agentDir,
    initialWorkspaces: [fixture.workspacePath],
    testMode: "background",
  });
  try {
    const window = await harness.firstWindow();
    await selectSession(window, TASK_A);
    await expect(window.getByTestId("composer")).toBeVisible();
    await expect(window.getByTestId("workbench")).toBeVisible();
    await expect(
      window.getByRole("tablist", { name: "Workspace tools" }).getByRole("tab"),
    ).toHaveText(["Tasks", "Files", "Review"]);
  } finally {
    await harness.close();
  }
});

test("two windows keep independent tool selections for the same task", async () => {
  test.setTimeout(90_000);
  const fixture = await prepareWorkspace();
  const harness = await launchDesktop(fixture.userDataDir, {
    agentDir: fixture.agentDir,
    initialWorkspaces: [fixture.workspacePath],
    testMode: "background",
  });
  try {
    const window = await harness.firstWindow();
    await selectSession(window, TASK_A);
    const second = await openSecondWindow(harness);
    await expect(second.getByTestId("composer")).toBeVisible();

    await window.getByRole("tab", { name: "Files", exact: true }).click();
    await expectActiveTool(window, "Files");
    await expect(second.getByRole("tab", { name: "Files", exact: true })).toHaveAttribute(
      "aria-selected",
      "false",
    );
    await second.getByRole("tab", { name: "Review", exact: true }).click();
    await expectActiveTool(second, "Review");
    await expectActiveTool(window, "Files");
  } finally {
    await harness.close();
  }
});

test("keeps one side panel width across tools and a restart", async ({}, testInfo) => {
  test.setTimeout(120_000);
  const fixture = await prepareWorkspace();
  const launch = () =>
    launchDesktop(fixture.userDataDir, {
      agentDir: fixture.agentDir,
      initialWorkspaces: [fixture.workspacePath],
      testMode: "background",
      recordVideoDir: undefined,
    });

  const firstRun = await launch();
  let width = 0;
  try {
    const window = await firstRun.firstWindow();
    await selectSession(window, TASK_A);
    await captureToolWidths(firstRun, window, testInfo, "Tasks");
    const resized = await firstRun.electronApp.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0];
      if (!window) return 0;
      const [currentWidth] = window.getSize();
      window.setSize(Math.max(1100, currentWidth), 900);
      return currentWidth;
    });
    expect(resized).toBeGreaterThan(0);
    width = (await window.getByTestId("workbench").boundingBox())?.width ?? 0;
  } finally {
    await firstRun.close();
  }

  const secondRun = await launch();
  try {
    const window = await secondRun.firstWindow();
    await selectSession(window, TASK_A);
    const restored = (await window.getByTestId("workbench").boundingBox())?.width ?? 0;
    expect(Math.abs(restored - width)).toBeLessThan(2);
  } finally {
    await secondRun.close();
  }
});
