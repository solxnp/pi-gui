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
  expect(board.groups.map((group) => group.status)).toEqual(["doing", "todo", "other"]);
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

test("status text maps in-progress before to-do, everything else last", () => {
  expect(tasksStatusFromText("进行中")).toBe("doing");
  expect(tasksStatusFromText("待做（阻塞：等通知）")).toBe("todo");
  expect(tasksStatusFromText("已完成")).toBe("other");
  expect(tasksStatusFromText("阻塞")).toBe("other");
});
