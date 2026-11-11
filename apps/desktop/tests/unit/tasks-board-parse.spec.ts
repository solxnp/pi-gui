import { expect, test } from "@playwright/test";
import {
  cleanTasksText,
  parseTasksBoard,
  tasksStatusFromText,
} from "../../src/features/workbench/tasks-board/parse-tasks";

const BOARD = `# TASKS

## 一、解析约定

| 规则 | 具体 |
|---|---|
| 认哪些条目 | 标题 + 状态行 |

## 二、任务清单

### P0-02 客户端本地 dev 验证

| 项 | 内容 |
|---|---|
| 状态 | 待做（阻塞：只能用户本人做） |

**步骤**

- [x] npm run dev
- [ ] 逐项过 §8 阶段 A

### P0-01 提交后端化改造

| 项 | 内容 |
|---|---|
| 状态 | 进行中 |

- [ ] 分 3 个 commit
- [ ] 提交后确认工作区干净

### P0-09 已经做完的

| 项 | 内容 |
|---|---|
| 状态 | 已完成 |

- [x] 全量导出
`;

test("groups follow the status ranking, then file order", () => {
  const board = parseTasksBoard(BOARD);
  expect(board.groups.map((group) => group.title)).toEqual([
    "P0-01 提交后端化改造",
    "P0-02 客户端本地 dev 验证",
    "P0-09 已经做完的",
  ]);
  expect(board.groups.map((group) => group.status)).toEqual(["doing", "todo", "done"]);
});

test("keeps raw status detail and counts open and done items", () => {
  const board = parseTasksBoard(BOARD);
  const blocked = board.groups.find((group) => group.title.startsWith("P0-02"));
  expect(blocked?.statusText).toBe("待做（阻塞：只能用户本人做）");
  expect(board.openItems).toBe(3);
  expect(board.doneItems).toBe(2);
});

test("a checkbox list under a plain heading counts as a to-do list", () => {
  const board = parseTasksBoard("## 收尾\n\n- [ ] 写文档\n- [x] 跑测试\n");
  expect(board.groups).toHaveLength(1);
  expect(board.groups[0].status).toBe("todo");
  expect(board.groups[0].title).toBe("收尾");
  expect(board.groups[0].items.map((item) => item.done)).toEqual([false, true]);
});

test("headings with neither a status row nor items are dropped", () => {
  const board = parseTasksBoard(
    "# TASKS\n\n## 一、铁律\n\n| # | 规则 |\n|---|---|\n| 1 | 别乱动 |\n",
  );
  expect(board.groups).toEqual([]);
  expect(board.openItems).toBe(0);
});

test("checkbox items before any heading still show up", () => {
  const board = parseTasksBoard("- [ ] 开头的条目\n");
  expect(board.groups).toHaveLength(1);
  expect(board.groups[0].title).toBe("");
  expect(board.groups[0].items[0].text).toBe("开头的条目");
});

test("cleans markdown emphasis out of titles and items", () => {
  expect(cleanTasksText("**P0-01** 提交 `server/`")).toBe("P0-01 提交 server/");
  const board = parseTasksBoard("### **P0-03** 发版\n\n- [ ] 跑 `npm version`\n");
  expect(board.groups[0].title).toBe("P0-03 发版");
  expect(board.groups[0].items[0].text).toBe("跑 npm version");
});

test("status text maps in-progress first, then cancelled, then to-do, then done", () => {
  expect(tasksStatusFromText("进行中")).toBe("doing");
  expect(tasksStatusFromText("待做（阻塞：等通知）")).toBe("todo");
  expect(tasksStatusFromText("已完成")).toBe("done");
  expect(tasksStatusFromText("取消（决定不做了）")).toBe("cancelled");
});

test("a finished-work section turns its table rows into done items", () => {
  const board = parseTasksBoard(`## 四、已完成

| 项 | 结果 |
|---|---|
| 全量导出 | 20 MB |
| \`enc_key\` | 逐字节一致 |
`);
  expect(board.groups).toHaveLength(1);
  expect(board.groups[0].status).toBe("done");
  expect(board.groups[0].items.map((item) => item.text)).toEqual(["全量导出", "enc_key"]);
  expect(board.doneItems).toBe(2);
});

test("task tables outside a finished section do not become items", () => {
  const board = parseTasksBoard(`### P0-01 提交

| 项 | 内容 |
|---|---|
| 状态 | 待做 |
| 提交 | — |
`);
  expect(board.groups[0].items).toEqual([]);
});

test("reads the commit row so the panel can flag unverified 已完成 rows", () => {
  const board = parseTasksBoard(`### P0-01 做完了

| 项 | 内容 |
|---|---|
| 状态 | 已完成 |
| 提交 | \`7db402b\` |

### P0-02 也标了完成

| 项 | 内容 |
|---|---|
| 状态 | 已完成 |
| 提交 | — |
`);
  const [first, second] = board.groups;
  expect(first?.commit).toBe("7db402b");
  expect(second?.commit).toBeUndefined();
});

test("a cell listing several commits still counts as verified", () => {
  const board = parseTasksBoard(`### P0-00 三件套

| 项 | 内容 |
|---|---|
| 状态 | 已完成 |
| 提交 | \`c3e0097\`（台账 tab）、\`4a07045\`（概况条） |
`);
  expect(board.groups[0]?.commit).toBe("c3e0097");
});

test("a legacy finished section has no status cell, so it is not treated as an unverified task", () => {
  const board = parseTasksBoard("## 四、已完成\n\n| 项 | 结果 |\n|---|---|\n| 导出 | ok |\n");
  expect(board.groups[0]?.status).toBe("done");
  expect(board.groups[0]?.statusText).toBe("");
  expect(board.groups[0]?.commit).toBeUndefined();
});
