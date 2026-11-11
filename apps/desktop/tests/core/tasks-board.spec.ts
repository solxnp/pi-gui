import { readFile, writeFile } from "node:fs/promises";
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

## 一、状态约定

| 取值 | 含义 |
|---|---|
| 待做 | 还没开始 |

## 二、任务

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

### P0-09 已经放弃的实验

| 项 | 内容 |
|---|---|
| 状态 | 取消（改走另一个方案） |

## 四、已完成

| 项 | 结果 |
|---|---|
| 全量导出 | 20 MB |
| enc_key 校验 | 逐字节一致 |
`;

const OTHER_PROJECT_MARKDOWN = `# TASKS

### Q-01 另一个项目的活

| 项 | 内容 |
|---|---|
| 状态 | 待做 |

### Q-02 另一个项目第二件

| 项 | 内容 |
|---|---|
| 状态 | 待做 |
`;

async function prepareWorkspaces(withTasks: boolean) {
  const userDataDir = await makeUserDataDir();
  const agentDir = join(userDataDir, "agent");
  const workspacePath = await makeWorkspace("tasks-board");
  const otherPath = await makeWorkspace("tasks-other");
  if (withTasks) {
    await writeFile(join(workspacePath, "TASKS.md"), TASKS_MARKDOWN);
    await writeFile(join(otherPath, "TASKS.md"), OTHER_PROJECT_MARKDOWN);
  }
  await initGitRepo(workspacePath);
  await commitAllInGitRepo(workspacePath, "Tasks board fixture");
  await initGitRepo(otherPath);
  await commitAllInGitRepo(otherPath, "Other project fixture");
  await seedAgentDir(agentDir, { withOpenAiAuth: false });
  await seedNamedTextSessionFixture(agentDir, workspacePath, {
    title: TASK,
    userText: "Read the task list",
    assistantText: "Reading TASKS.md.",
  });
  return { userDataDir, agentDir, workspacePath, otherPath };
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
  const fixture = await prepareWorkspaces(true);
  const harness = await launchDesktop(fixture.userDataDir, {
    agentDir: fixture.agentDir,
    initialWorkspaces: [fixture.workspacePath, fixture.otherPath],
    testMode: "background",
  });
  try {
    const window = await harness.firstWindow();
    await selectSession(window, TASK);

    // The one-line overview above the composer reads the same ledger.
    await expect(window.getByTestId("session-overview-task")).toHaveText(/P0-01 提交后端化改造/);

    await openTool(window, "Tasks");
    const board = window.getByTestId("tasks-board");
    await expect(board).toBeVisible();

    // Cross-project switcher: every root workspace, with its own counts.
    const project = window.getByTestId("tasks-board-project");
    await expect(project.locator("option")).toHaveCount(2);
    await expect(project.locator("option", { hasText: "tasks-other" })).toContainText(
      /待做 2|to do 2/,
    );

    const doing = window.getByTestId("tasks-board-section-doing");
    const todo = window.getByTestId("tasks-board-section-todo");
    await expect(doing).toContainText("P0-01 提交后端化改造");
    await expect(todo).toContainText("P0-02 客户端本地验证");
    // The raw status cell survives as a tooltip, so a blocking reason is not lost.
    await expect(
      todo.locator(".tasks-board__group-title", { hasText: "P0-02 客户端本地验证" }),
    ).toHaveAttribute("title", "待做（阻塞：只能用户本人做）");
    // Cancelled work must not masquerade as to-do.
    await expect(todo).not.toContainText("P0-09");

    // Finished work starts collapsed, and its table rows become steps.
    const done = window.getByTestId("tasks-board-section-done");
    await expect(done).not.toContainText("全量导出");
    await done.getByRole("button").first().click();
    await expect(done).toContainText("全量导出");
    await expect(done).toContainText("enc_key 校验");

    const path = testInfo.outputPath("tasks-board.png");
    await window.screenshot({ path, animations: "disabled" });
    await testInfo.attach("tasks board", { path, contentType: "image/png" });

    // Adding a row from the panel writes it into the ledger, above the finished section.
    await window.getByTestId("tasks-board-new-title").fill("面板里加的一条");
    await window.getByTestId("tasks-board-add").click();
    await expect(todo).toContainText("面板里加的一条", { timeout: 10_000 });
    const written = await readFile(join(fixture.workspacePath, "TASKS.md"), "utf8");
    expect(written).toContain("### 面板里加的一条");
    expect(written.indexOf("### 面板里加的一条")).toBeLessThan(written.indexOf("## 四、已完成"));

    await todo.getByRole("button", { name: /跑 npm run dev/ }).click();
    await expect(window.getByTestId("composer")).toHaveValue(/P0-02 客户端本地验证/);
    await expect(window.getByTestId("composer")).toHaveValue(/跑 npm run dev/);
  } finally {
    await harness.close();
  }
});

test("explains itself when the workspace has no task list", async () => {
  test.setTimeout(60_000);
  const fixture = await prepareWorkspaces(false);
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
    await expect(board).toContainText("TASKS.md");
    // Without a ledger there is no task segment; the strip may still show a branch.
    await expect(window.getByTestId("session-overview-task")).toHaveCount(0);
  } finally {
    await harness.close();
  }
});
