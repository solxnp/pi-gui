import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { applyTaskStatus, updateTasksBoardTaskStatus } from "../../electron/tasks/tasks-file";

const BOARD = `# TASKS

### P0-01 第一件事

| 项 | 内容 |
|---|---|
| 状态 | 待做 |
| 提交 | \`e48731f\` |

### P0-02 第二件事

| 项 | 内容 |
|---|---|
| 状态 | 待做 |
| 提交 | — |

## 四、已完成

| 项 | 结果 |
|---|---|
| 旧活 | ok |
`;

test("rewrites only the matched task's status row", () => {
  const { markdown, title } = applyTaskStatus(BOARD, "P0-02", "进行中");
  expect(title).toBe("P0-02 第二件事");
  const lines = markdown.split("\n");
  const p1 = lines.slice(lines.indexOf("### P0-01 第一件事"), lines.indexOf("### P0-02 第二件事"));
  const p2 = lines.slice(lines.indexOf("### P0-02 第二件事"), lines.indexOf("## 四、已完成"));
  expect(p1.join("|")).toContain("| 状态 | 待做 |");
  expect(p2.join("|")).toContain("| 状态 | 进行中 |");
  expect(markdown).toContain("| 旧活 | ok |");
});

test("rejects unknown and ambiguous task ids", () => {
  expect(() => applyTaskStatus(BOARD, "P9-99", "待做")).toThrow(/No task matches/);
  const duplicated = `${BOARD}\n### P0-01 又一个同名\n\n| 状态 | 待做 |\n`;
  expect(() => applyTaskStatus(duplicated, "P0-01", "进行中")).toThrow(/matches 2 tasks/);
});

test("a stale read is refused instead of overwriting somebody else's edit", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tasks-status-"));
  try {
    await writeFile(join(dir, "TASKS.md"), BOARD);
    const stale = 1;
    await expect(
      updateTasksBoardTaskStatus(dir, {
        task: "P0-01",
        status: "进行中",
        expectedModifiedAtMs: stale,
      }),
    ).rejects.toThrow(/changed on disk/);
    expect(await readFile(join(dir, "TASKS.md"), "utf8")).toBe(BOARD);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("writes when the read is current, and reports the ledger it touched", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tasks-status-"));
  try {
    await writeFile(join(dir, "TASKS.md"), BOARD);
    const { mtimeMs } = await import("node:fs/promises").then((fs) =>
      fs.stat(join(dir, "TASKS.md")),
    );
    const result = await updateTasksBoardTaskStatus(dir, {
      task: "P0-01",
      status: "待验证",
      expectedModifiedAtMs: mtimeMs,
    });
    expect(result).toEqual({ path: "TASKS.md", title: "P0-01 第一件事", status: "待验证" });
    expect(await readFile(join(dir, "TASKS.md"), "utf8")).toContain("| 状态 | 待验证 |");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("the rewritten board keeps every other byte, so it stays the same ledger", () => {
  // The pi tool keeps its own copy at ~/.pi/agent/lib/tasks-ledger.ts; this pins the shape
  // both must produce: only the status cell changes, line count and neighbours do not.
  const applied = applyTaskStatus(BOARD, "P0-02", "取消").markdown;
  const expected = BOARD.replace(
    "### P0-02 第二件事\n\n| 项 | 内容 |\n|---|---|\n| 状态 | 待做 |",
    "### P0-02 第二件事\n\n| 项 | 内容 |\n|---|---|\n| 状态 | 取消 |",
  );
  expect(applied).toBe(expected);
});
