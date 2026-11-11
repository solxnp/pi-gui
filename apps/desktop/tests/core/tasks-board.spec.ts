import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import {
  commitAllInGitRepo,
  initGitRepo,
  launchDesktop,
  makeUserDataDir,
  makeWorkspace,
  seedAgentDir,
  seedNamedTextSessionFixture,
  selectSession,
} from "../helpers/electron-app";

const TASK = "Tasks board task";

const TASKS_MARKDOWN = `# TASKS

## 一、面板解析约定

| 规则 | 具体 |
|---|---|
| 认哪些条目 | 标题 + 状态行 |

## 二、任务清单

### P0-02 客户端本地验证

| 项 | 内容 |
|---|---|
| 状态 | 待做（阻塞：只能用户本人做） |

- [ ] 跑 npm run dev
- [x] 起测试库隧道

### P0-01 提交后端化改造

| 项 | 内容 |
|---|---|
| 状态 | 进行中 |

- [ ] 分 3 个 commit
`;

async function prepareWorkspace(withTasks: boolean) {
  const userDataDir = await makeUserDataDir();
  const agentDir = join(userDataDir, "agent");
  const workspacePath = await makeWorkspace("tasks-board");
  if (withTasks) await writeFile(join(workspacePath, "TASKS.md"), TASKS_MARKDOWN);
  await initGitRepo(workspacePath);
  await commitAllInGitRepo(workspacePath, "Tasks board fixture");
  await seedAgentDir(agentDir, { withOpenAiAuth: false });
  await seedNamedTextSessionFixture(agentDir, workspacePath, {
    title: TASK,
    userText: "Read the task list",
    assistantText: "Reading TASKS.md.",
  });
  return { userDataDir, agentDir, workspacePath };
}

/** Tasks without a saved layout start with the workbench hidden. */
async function openTool(window: Page, name: string): Promise<void> {
  const workbench = window.getByTestId("workbench");
  if (!(await workbench.isVisible())) await window.getByTestId("toggle-side-panel").click();
  await expect(workbench).toBeVisible();
  await window.getByTestId("workbench-add-tab").click();
  const chooser = window.getByTestId("workbench-chooser");
  await expect(chooser).toBeVisible();
  await chooser.getByRole("button", { name, exact: true }).click();
  await expect(workbench.getByRole("tab", { name, exact: true })).toHaveAttribute(
    "aria-selected",
    "true",
  );
}

test("reads TASKS.md, ranks in-progress first, and puts a row in the composer", async ({}, testInfo) => {
  test.setTimeout(60_000);
  const fixture = await prepareWorkspace(true);
  const harness = await launchDesktop(fixture.userDataDir, {
    agentDir: fixture.agentDir,
    initialWorkspaces: [fixture.workspacePath],
    testMode: "background",
  });
  try {
    const window = await harness.firstWindow();
    await selectSession(window, TASK);
    await openTool(window, "Tasks");

    // The one-line overview above the composer reads the same ledger.
    const overview = window.getByTestId("session-overview");
    await expect(overview).toBeVisible();
    await expect(window.getByTestId("session-overview-task")).toHaveText(/P0-01 提交后端化改造/);

    const board = window.getByTestId("tasks-board");
    await expect(board).toBeVisible();
    const groups = board.locator(".tasks-board__group-title");
    await expect(groups).toHaveText(["P0-01 提交后端化改造", "P0-02 客户端本地验证"]);
    await expect(board.locator(".tasks-board__badge--doing")).toHaveCount(1);
    await expect(board.locator(".tasks-board__badge--todo")).toHaveAttribute(
      "title",
      "待做（阻塞：只能用户本人做）",
    );
    await expect(board.locator(".tasks-board__summary")).toContainText(/2\s*(条待做|to do)/);

    const path = testInfo.outputPath("tasks-board.png");
    await window.screenshot({ path, animations: "disabled" });
    await testInfo.attach("tasks board", { path, contentType: "image/png" });

    await board.getByRole("button", { name: /跑 npm run dev/ }).click();
    await expect(window.getByTestId("composer")).toHaveValue(/P0-02 客户端本地验证/);
    await expect(window.getByTestId("composer")).toHaveValue(/跑 npm run dev/);

    // A to-do row keeps its open count, and finished rows stay struck through.
    await expect(board.locator(".tasks-board__item--done")).toHaveText(/起测试库隧道/);
  } finally {
    await harness.close();
  }
});

test("explains itself when the workspace has no task list", async () => {
  test.setTimeout(60_000);
  const fixture = await prepareWorkspace(false);
  const harness = await launchDesktop(fixture.userDataDir, {
    agentDir: fixture.agentDir,
    initialWorkspaces: [fixture.workspacePath],
    testMode: "background",
  });
  try {
    const window = await harness.firstWindow();
    await selectSession(window, TASK);
    await openTool(window, "Tasks");
    const board = window.getByTestId("tasks-board");
    // Locale-independent: the empty state names the file the panel looks for.
    await expect(board.locator(".tasks-board__empty")).toBeVisible();
    // Without a ledger there is no task segment; the strip may still show a branch.
    await expect(window.getByTestId("session-overview-task")).toHaveCount(0);
    await expect(board).toContainText("TASKS.md");
  } finally {
    await harness.close();
  }
});
