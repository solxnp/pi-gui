/*
 * Reads a markdown task ledger into groups for the side panel.
 *
 * Three shapes are supported because all of them are already in use:
 *   1. `### P0-01 标题` followed by a `| 状态 | 待做 |` row (task board style)
 *   2. `- [ ] 条目` checkboxes under any heading
 *   3. a `## 已完成` section whose table rows are the finished work
 *
 * The panel is read-only: nothing here writes back to the file, so the markdown
 * stays the single source of truth.
 */

export type TasksBoardStatus = "doing" | "todo" | "done" | "cancelled";

export interface TasksBoardItem {
  readonly id: string;
  readonly text: string;
  readonly done: boolean;
}

export interface TasksBoardGroup {
  readonly id: string;
  readonly title: string;
  readonly status: TasksBoardStatus;
  /** The raw status cell, kept for display when it carries extra detail. */
  readonly statusText: string;
  readonly items: readonly TasksBoardItem[];
}

export interface TasksBoard {
  readonly groups: readonly TasksBoardGroup[];
  readonly openItems: number;
  readonly doneItems: number;
}

/** Files the panel tries in order; the first readable one wins. */
export const TASKS_BOARD_FILES = ["TASKS.md", "docs/TASKS.md", "02-roadmap.md"] as const;

const MAX_GROUPS = 200;
const MAX_ITEMS = 500;
const HEADING = /^#{1,4}\s+(.+?)\s*$/;
const STATUS_ROW = /^\|\s*状态\s*\|\s*(.+?)\s*\|/;
const CHECKBOX = /^[-*]\s+\[([ xX])\]\s+(.+?)\s*$/;
const TABLE_ROW = /^\|(.+)\|\s*$/;
const TABLE_SEPARATOR = /^\|[\s:|-]+\|\s*$/;
const DONE_HEADING = /已完成|已交付|完成记录|\bcompleted\b|\bdone\b/i;
const MARKUP = /\*\*|__|`/g;
/** Table cells that describe a task rather than name work. */
const META_CELLS =
  /^(状态|提交|验收|阻塞|备注|前置|证据|坑|谁做|分工|涉及|冲突点|观察窗口|风险|回滚|为什么|规则|项|取值|含义|#)$/;

export function cleanTasksText(value: string): string {
  return value.replace(MARKUP, "").replace(/\s+/g, " ").trim();
}

/** Ranking mirrors the dashboard extension: in-progress first, then to-do, done last. */
export function tasksStatusFromText(value: string): TasksBoardStatus {
  if (/进行中|in progress/i.test(value)) return "doing";
  if (/取消|cancel/i.test(value)) return "cancelled";
  if (/待做|待验证|阻塞|todo|to do/i.test(value)) return "todo";
  return "done";
}

function statusRank(status: TasksBoardStatus): number {
  return status === "doing" ? 0 : status === "todo" ? 1 : status === "done" ? 2 : 3;
}

interface PendingGroup {
  title: string;
  status: TasksBoardStatus | null;
  statusText: string;
  items: TasksBoardItem[];
}

export function parseTasksBoard(markdown: string): TasksBoard {
  const groups: TasksBoardGroup[] = [];
  let pending: PendingGroup | null = null;
  let itemCount = 0;
  let inDoneSection = false;
  let tablePhase: "none" | "header" | "body" = "none";

  const start = (title: string): PendingGroup => ({
    title,
    status: null,
    statusText: "",
    items: [],
  });

  const flush = () => {
    if (!pending) return;
    if (pending.items.length === 0 && pending.status === null) {
      pending = null;
      return;
    }
    const open = pending.items.some((item) => !item.done);
    groups.push({
      id: `g${groups.length}`,
      title: pending.title,
      // A plain checkbox list under a heading is a to-do list even without a status row.
      status: pending.status ?? (open || pending.items.length === 0 ? "todo" : "done"),
      statusText: pending.statusText,
      items: pending.items,
    });
    pending = null;
  };

  for (const raw of markdown.split("\n")) {
    const line = raw.trim();
    if (!TABLE_ROW.test(line)) tablePhase = "none";

    const heading = HEADING.exec(line);
    if (heading) {
      flush();
      const title = cleanTasksText(heading[1] ?? "");
      inDoneSection = DONE_HEADING.test(title);
      pending = start(title);
      continue;
    }

    const statusRow = STATUS_ROW.exec(line);
    if (statusRow) {
      pending ??= start("");
      const statusText = statusRow[1] ?? "";
      pending.status = tasksStatusFromText(statusText);
      pending.statusText = cleanTasksText(statusText);
      continue;
    }

    const checkbox = CHECKBOX.exec(line);
    if (checkbox && itemCount < MAX_ITEMS) {
      pending ??= start("");
      pending.items.push({
        id: `i${itemCount}`,
        text: cleanTasksText(checkbox[2] ?? ""),
        done: (checkbox[1] ?? "").toLowerCase() === "x",
      });
      itemCount += 1;
      continue;
    }

    // Inside a finished-work section the table *is* the list of finished rows.
    if (inDoneSection && itemCount < MAX_ITEMS) {
      if (TABLE_SEPARATOR.test(line)) {
        tablePhase = "body";
        continue;
      }
      if (tablePhase !== "none") {
        tablePhase = tablePhase === "body" ? "body" : "header";
        if (tablePhase === "header") continue;
        const row = TABLE_ROW.exec(line);
        const first = cleanTasksText((row?.[1] ?? "").split("|")[0] ?? "");
        if (!first || META_CELLS.test(first) || /^-+:?$/.test(first)) continue;
        pending ??= start("");
        if (pending.status === null) pending.status = "done";
        pending.items.push({ id: `i${itemCount}`, text: first, done: true });
        itemCount += 1;
      }
    }
  }
  flush();

  const ordered = groups
    .map((group, index) => ({ group, index }))
    .sort((left, right) => {
      const delta = statusRank(left.group.status) - statusRank(right.group.status);
      return delta === 0 ? left.index - right.index : delta;
    })
    .map((entry) => entry.group)
    .slice(0, MAX_GROUPS);

  let openItems = 0;
  let doneItems = 0;
  for (const group of groups) {
    for (const item of group.items) {
      if (item.done) doneItems += 1;
      else openItems += 1;
    }
  }
  return { groups: ordered, openItems, doneItems };
}
