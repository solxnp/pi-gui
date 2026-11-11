import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, unlink } from "node:fs/promises";
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
