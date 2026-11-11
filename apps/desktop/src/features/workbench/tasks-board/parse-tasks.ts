/*
 * Reads a markdown task ledger into groups for the side panel.
 *
 * Two shapes are supported because both are already in use across projects:
 *   1. `### P0-01 标题` followed by a `| 状态 | 待做 |` row (task board style)
 *   2. `- [ ] 条目` checkboxes under any heading
 *
 * The panel is read-only: nothing here writes back to the file, so the markdown
 * stays the single source of truth.
 */

export type TasksBoardStatus = "doing" | "todo" | "other";

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
const MARKUP = /\*\*|__|`/g;

export function cleanTasksText(value: string): string {
  return value.replace(MARKUP, "").replace(/\s+/g, " ").trim();
}

/** Ranking mirrors the dashboard extension: in-progress first, then to-do, then the rest. */
export function tasksStatusFromText(value: string): TasksBoardStatus {
  if (/进行中/.test(value)) return "doing";
  if (/待做|TODO/.test(value)) return "todo";
  return "other";
}

function statusRank(status: TasksBoardStatus): number {
  return status === "doing" ? 0 : status === "todo" ? 1 : 2;
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
      status: pending.status ?? (open || pending.items.length === 0 ? "todo" : "other"),
      statusText: pending.statusText,
      items: pending.items,
    });
    pending = null;
  };

  for (const raw of markdown.split("\n")) {
    const line = raw.trim();
    const heading = HEADING.exec(line);
    if (heading) {
      flush();
      pending = {
        title: cleanTasksText(heading[1] ?? ""),
        status: null,
        statusText: "",
        items: [],
      };
      continue;
    }
    const statusRow = STATUS_ROW.exec(line);
    if (statusRow) {
      pending ??= { title: "", status: null, statusText: "", items: [] };
      const statusText = statusRow[1] ?? "";
      pending.status = tasksStatusFromText(statusText);
      pending.statusText = cleanTasksText(statusText);
      continue;
    }
    const checkbox = CHECKBOX.exec(line);
    if (checkbox && itemCount < MAX_ITEMS) {
      pending ??= { title: "", status: null, statusText: "", items: [] };
      pending.items.push({
        id: `i${itemCount}`,
        text: cleanTasksText(checkbox[2] ?? ""),
        done: (checkbox[1] ?? "").toLowerCase() === "x",
      });
      itemCount += 1;
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
