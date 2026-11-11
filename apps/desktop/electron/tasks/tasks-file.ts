import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, stat, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";

/**
 * Appending one to-do row to a workspace ledger.
 *
 * The write stays narrow on purpose: only `TASKS.md` / `docs/TASKS.md`, only an
 * append shaped like the ledger template. The renderer never sends file bytes,
 * so this path cannot be reused to overwrite arbitrary files.
 */

export const TASKS_FILE_CANDIDATES = ["TASKS.md", "docs/TASKS.md"] as const;
export const MAX_TASK_TITLE_LENGTH = 120;
export const NEW_TASKS_FILE = "# TASKS\n\n";
/** New rows go above the finished-work section, never below it. */
const DONE_HEADING = /^#{1,2}\s+.*(已完成|已交付|完成记录|\bcompleted\b|\bdone\b)/i;

export function normalizeTaskTitle(raw: string): string {
  const title = raw
    .replace(/[#*`]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_TASK_TITLE_LENGTH);
  return title;
}

/** The canonical block a new task is written as; the panel parser reads it back. */
export function tasksTaskBlock(title: string): string {
  return [`### ${title}`, "", "| 项 | 内容 |", "|---|---|", "| 状态 | 待做 |", "| 提交 | — |"].join(
    "\n",
  );
}

/** Inserts the block above the finished-work section, or at the end when there is none. */
export function insertTaskBlock(markdown: string, title: string): string {
  const block = tasksTaskBlock(title).split("\n");
  const lines = markdown.split("\n");
  const doneHeading = lines.findIndex((line) => DONE_HEADING.test(line.trim()));
  if (doneHeading < 0) {
    return `${markdown.replace(/\s+$/, "")}\n\n${block.join("\n")}\n`;
  }
  const head = lines.slice(0, doneHeading);
  while (head.length > 0 && (head[head.length - 1] ?? "").trim() === "") head.pop();
  const tail = lines.slice(doneHeading);
  return [...head, "", ...block, "", ...tail].join("\n");
}

async function writeFileAtomically(filePath: string, contents: string): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${randomUUID()}.tmp`;
  try {
    const handle = await open(temporary, "w");
    try {
      await handle.writeFile(contents, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temporary, filePath);
  } catch (error) {
    await unlink(temporary).catch(() => undefined);
    throw error;
  }
}

export class LedgerChangedError extends Error {
  readonly code = "ledger-changed";
  constructor() {
    super("TASKS.md changed on disk since the panel read it; reload and try again.");
    this.name = "LedgerChangedError";
  }
}

const STATUS_VALUES = ["待做", "进行中", "待验证", "已完成", "取消"] as const;
export type LedgerTaskStatus = (typeof STATUS_VALUES)[number];

const HEADING = /^(#{1,4})\s+(.+?)\s*$/;
const STATUS_ROW = /^\|\s*状态\s*\|/;

function cleanHeadingTitle(value: string): string {
  return value.replace(/\*\*|__|`/g, "").trim();
}

/**
 * Rewrites one task's status row. Mirrors `~/.pi/agent/lib/tasks-ledger.ts`, which the
 * `tasks_update` agent tool uses; the two must stay in step (same anchor rules, same errors).
 */
export function applyTaskStatus(
  markdown: string,
  task: string,
  status: LedgerTaskStatus,
): { readonly markdown: string; readonly title: string } {
  if (!STATUS_VALUES.includes(status)) {
    throw new Error(`Unknown status "${status}". Use one of: ${STATUS_VALUES.join(" / ")}`);
  }
  const wanted = cleanHeadingTitle(task);
  if (wanted.length === 0) throw new Error("A task id is required.");

  const lines = markdown.split("\n");
  const headings: { index: number; level: number; title: string }[] = [];
  lines.forEach((line, index) => {
    const match = HEADING.exec(line.trim());
    if (!match) return;
    headings.push({
      index,
      level: (match[1] ?? "").length,
      title: cleanHeadingTitle(match[2] ?? ""),
    });
  });

  const matches = headings.filter(
    (heading) =>
      heading.title === wanted ||
      heading.title.startsWith(`${wanted} `) ||
      heading.title.startsWith(`${wanted}（`) ||
      heading.title.startsWith(`${wanted}(`),
  );
  if (matches.length === 0) {
    const known = headings
      .map((heading) => heading.title)
      .filter((title) => /^[A-Z]+\d*-\d+/.test(title))
      .slice(0, 10);
    throw new Error(
      `No task matches "${task}". Known tasks: ${known.length > 0 ? known.join("、") : "(none)"}`,
    );
  }
  if (matches.length > 1) {
    throw new Error(
      `"${task}" matches ${matches.length} tasks: ${matches
        .map((heading) => heading.title)
        .join("、")}. Be more specific.`,
    );
  }

  const hit = matches[0];
  if (!hit) throw new Error(`No task matches "${task}".`);
  let end = lines.length;
  for (const heading of headings) {
    if (heading.index > hit.index && heading.level <= hit.level) {
      end = heading.index;
      break;
    }
  }

  let replaced = false;
  for (let index = hit.index; index < end; index += 1) {
    if (STATUS_ROW.test(lines[index] ?? "")) {
      lines[index] = `| 状态 | ${status} |`;
      replaced = true;
      break;
    }
  }
  if (!replaced) lines.splice(hit.index + 1, 0, `| 状态 | ${status} |`);
  return { markdown: lines.join("\n"), title: hit.title };
}

async function assertUnchanged(filePath: string, expectedModifiedAtMs?: number): Promise<void> {
  if (expectedModifiedAtMs === undefined) return;
  const stats = await stat(filePath);
  if (Math.abs(stats.mtimeMs - expectedModifiedAtMs) > 1) throw new LedgerChangedError();
}

export interface UpdatedTask {
  readonly path: string;
  readonly title: string;
  readonly status: LedgerTaskStatus;
}

/** Rewrites one task's status; refuses an unknown task, an ambiguous match, or a stale read. */
export async function updateTasksBoardTaskStatus(
  workspacePath: string,
  input: {
    readonly task: string;
    readonly status: LedgerTaskStatus;
    readonly expectedModifiedAtMs?: number;
  },
): Promise<UpdatedTask> {
  for (const candidate of TASKS_FILE_CANDIDATES) {
    const absolute = join(workspacePath, candidate);
    let existing: string;
    try {
      existing = await readFile(absolute, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw error;
    }
    await assertUnchanged(absolute, input.expectedModifiedAtMs);
    const applied = applyTaskStatus(existing, input.task, input.status);
    await writeFileAtomically(absolute, applied.markdown);
    return { path: candidate, title: applied.title, status: input.status };
  }
  throw new Error("No TASKS.md (or docs/TASKS.md) in this workspace.");
}

export interface CreatedTask {
  readonly path: string;
  readonly created: boolean;
}

export function isTaskTitleError(raw: string, title: string): boolean {
  return raw.trim().length > 0 && title.length === 0;
}

/** Writes one new to-do row into the ledger, creating `TASKS.md` when none exists. */
export async function createTasksBoardTask(
  workspacePath: string,
  rawTitle: string,
  expectedModifiedAtMs?: number,
): Promise<CreatedTask> {
  const title = normalizeTaskTitle(rawTitle);
  if (title.length === 0) throw new Error("A task needs a title.");

  for (const candidate of TASKS_FILE_CANDIDATES) {
    const absolute = join(workspacePath, candidate);
    let existing: string;
    try {
      existing = await readFile(absolute, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw error;
    }
    await assertUnchanged(absolute, expectedModifiedAtMs);
    await writeFileAtomically(absolute, insertTaskBlock(existing, title));
    return { path: candidate, created: false };
  }

  const path = TASKS_FILE_CANDIDATES[0];
  await writeFileAtomically(
    join(workspacePath, path),
    `${NEW_TASKS_FILE}${tasksTaskBlock(title)}\n`,
  );
  return { path, created: true };
}
