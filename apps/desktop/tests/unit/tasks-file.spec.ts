import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import {
  createTasksBoardTask,
  insertTaskBlock,
  normalizeTaskTitle,
  tasksTaskBlock,
} from "../../electron/tasks/tasks-file";

test("appends the canonical block at the end when there is no finished section", () => {
  const next = insertTaskBlock(
    "# TASKS\n\n### P0-01 老任务\n\n| 项 | 内容 |\n|---|---|\n| 状态 | 待做 |\n",
    "P0-02 新任务",
  );
  expect(next).toContain("### P0-02 新任务");
  expect(next.indexOf("### P0-01 老任务")).toBeLessThan(next.indexOf("### P0-02 新任务"));
  expect(next.endsWith("\n")).toBe(true);
});

test("inserts above the finished-work section instead of after it", () => {
  const markdown =
    "# TASKS\n\n### P0-01 在做\n\n## 四、已完成\n\n| 项 | 结果 |\n|---|---|\n| 导出 | ok |\n";
  const next = insertTaskBlock(markdown, "P0-02 还没做");
  expect(next.indexOf("### P0-02 还没做")).toBeLessThan(next.indexOf("## 四、已完成"));
  // The finished section keeps its rows intact.
  expect(next).toContain("| 导出 | ok |");
});

test("normalizes stray markup and caps the title length", () => {
  expect(normalizeTaskTitle("  ### **P0-03**  `发版`  ")).toBe("P0-03 发版");
  expect(normalizeTaskTitle("x".repeat(400))).toHaveLength(120);
});

test("a new block uses exactly the status the parser reads back", () => {
  expect(tasksTaskBlock("P0-04 增量迁移")).toBe(
    "### P0-04 增量迁移\n\n| 项 | 内容 |\n|---|---|\n| 状态 | 待做 |\n| 提交 | — |",
  );
});

test("creates TASKS.md when the workspace has no ledger", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tasks-file-"));
  try {
    const result = await createTasksBoardTask(dir, "第一件事");
    expect(result).toEqual({ path: "TASKS.md", created: true });
    const written = await readFile(join(dir, "TASKS.md"), "utf8");
    expect(written).toContain("# TASKS");
    expect(written).toContain("### 第一件事");
    expect(written).toContain("| 状态 | 待做 |");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("appends to docs/TASKS.md when that is the ledger that exists", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tasks-file-"));
  try {
    await mkdir(join(dir, "docs"), { recursive: true });
    await writeFile(
      join(dir, "docs", "TASKS.md"),
      "# TASKS\n\n### 旧的\n\n| 项 | 内容 |\n|---|---|\n| 状态 | 待做 |\n",
    );
    const result = await createTasksBoardTask(dir, "追加的一条");
    expect(result).toEqual({ path: "docs/TASKS.md", created: false });
    const written = await readFile(join(dir, "docs", "TASKS.md"), "utf8");
    expect(written).toContain("### 追加的一条");
    expect(written).toContain("### 旧的");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
