/**
 * Restores a checkout to the state it had before one captured turn.
 *
 * The scope is what that turn actually changed: paths that differ between its before and after
 * trees. A file the turn never touched is left alone even when it is untracked, so restoring a turn
 * cannot wipe work that was not part of it.
 *
 * Snapshot objects live in pi-gui's own Git store, so the user's repository is only read from:
 * no index write, no commit, no ref.
 */

import { spawn } from "node:child_process";
import { rm, stat } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";

export type RestoreFailureCode =
  "checkout-mismatch" | "checkpoint-missing" | "storage-unavailable" | "git-failed";

export interface RestoreFailure {
  readonly code: RestoreFailureCode;
  readonly message: string;
}

export interface RestoreEntry {
  readonly path: string;
  /** `restore` writes the file back; `remove` deletes a file the turn created. */
  readonly change: "restore" | "remove";
  readonly additions: number;
  readonly deletions: number;
}

export interface RestorePreview {
  readonly entries: readonly RestoreEntry[];
  readonly failure?: RestoreFailure;
}

export interface RestoreResult {
  readonly restored: readonly string[];
  readonly removed: readonly string[];
  readonly failure?: RestoreFailure;
}

export interface RestoreInput {
  /** The app-owned object store holding the snapshot trees. */
  readonly repositoryPath: string;
  /** The working tree being restored. */
  readonly checkoutPath: string;
  readonly beforeTreeOid: string;
  readonly afterTreeOid: string;
  /** When set, only these paths of the turn are restored; the rest of the turn is left as it is. */
  readonly paths?: readonly string[];
}

interface GitResult {
  readonly stdout: Buffer;
  readonly stderr: string;
}

const TREE_OID = /^[a-f0-9]{40}$/;

function git(cwd: string, args: readonly string[], stdin?: Buffer): Promise<GitResult> {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn("git", ["--git-dir", cwd, ...args], {
      stdio: ["pipe", "pipe", "pipe"],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.on("error", rejectRun);
    child.on("close", (code) => {
      if (code === 0) {
        resolveRun({ stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr).toString() });
        return;
      }
      rejectRun(new Error(Buffer.concat(stderr).toString().trim() || `git exited with ${code}`));
    });
    child.stdin.end(stdin ?? Buffer.alloc(0));
  });
}

/** Snapshot trees only ever contain relative paths; anything else is refused before it reaches disk. */
function isSafeRelativePath(path: string): boolean {
  if (path.length === 0 || path.startsWith("/") || path.includes("\0")) {
    return false;
  }
  return path.split("/").every((segment) => segment !== "" && segment !== "." && segment !== "..");
}

function splitNul(buffer: Buffer): string[] {
  return buffer
    .toString("utf8")
    .split("\0")
    .filter((part) => part.length > 0);
}

async function changedPaths(input: RestoreInput): Promise<Map<string, string>> {
  const { stdout } = await git(input.repositoryPath, [
    "diff-tree",
    "-r",
    "-z",
    "--no-commit-id",
    "--name-status",
    input.beforeTreeOid,
    input.afterTreeOid,
  ]);
  const parts = splitNul(stdout);
  const statuses = new Map<string, string>();
  for (let index = 0; index + 1 < parts.length; index += 2) {
    const status = parts[index] ?? "";
    const path = parts[index + 1] ?? "";
    if (status === "" || path === "") {
      continue;
    }
    statuses.set(path, status.slice(0, 1));
  }
  return statuses;
}

async function lineCounts(input: RestoreInput): Promise<Map<string, [number, number]>> {
  const { stdout } = await git(input.repositoryPath, [
    "diff",
    "--numstat",
    "-z",
    input.beforeTreeOid,
    input.afterTreeOid,
  ]);
  const counts = new Map<string, [number, number]>();
  for (const record of stdout.toString("utf8").split("\0")) {
    const [added, deleted, ...rest] = record.split("\t");
    if (added === undefined || deleted === undefined || rest.length === 0) {
      continue;
    }
    const path = rest.join("\t");
    counts.set(path, [Number(added) || 0, Number(deleted) || 0]);
  }
  return counts;
}

function failure(code: RestoreFailureCode, message: string): RestorePreview {
  return { entries: [], failure: { code, message } };
}

async function buildPlan(input: RestoreInput): Promise<RestorePreview> {
  if (!TREE_OID.test(input.beforeTreeOid) || !TREE_OID.test(input.afterTreeOid)) {
    return failure("storage-unavailable", "快照树不完整，无法回退。");
  }
  const checkout = resolve(input.checkoutPath);
  try {
    const info = await stat(checkout);
    if (!info.isDirectory()) {
      return failure("checkout-mismatch", "工作区目录不存在，回退已取消。");
    }
  } catch {
    return failure("checkout-mismatch", "工作区目录不存在，回退已取消。");
  }

  let statuses: Map<string, string>;
  let counts: Map<string, [number, number]>;
  try {
    [statuses, counts] = await Promise.all([changedPaths(input), lineCounts(input)]);
  } catch {
    return failure("storage-unavailable", "快照存储无法读取，回退已取消。");
  }

  const wanted = input.paths ? new Set(input.paths) : undefined;
  const entries: RestoreEntry[] = [];
  for (const [path, status] of statuses) {
    if (wanted && !wanted.has(path)) {
      continue;
    }
    if (!isSafeRelativePath(path)) {
      return failure("checkpoint-missing", `快照里有一个不安全的路径，回退已取消：${path}`);
    }
    const [additions, deletions] = counts.get(path) ?? [0, 0];
    entries.push({
      path,
      // A file the turn created is removed; anything else is written back from the before tree.
      change: status === "A" ? "remove" : "restore",
      additions,
      deletions,
    });
  }
  entries.sort((left, right) => left.path.localeCompare(right.path));
  return { entries };
}

export async function previewTurnRestore(input: RestoreInput): Promise<RestorePreview> {
  return buildPlan(input);
}

async function extractPaths(input: RestoreInput, paths: readonly string[]): Promise<void> {
  if (paths.length === 0) {
    return;
  }
  const archive = spawn(
    "git",
    [
      "--git-dir",
      input.repositoryPath,
      "archive",
      "--format=tar",
      input.beforeTreeOid,
      "--",
      ...paths,
    ],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  const extract = spawn("tar", ["-x", "-f", "-", "-C", input.checkoutPath], {
    stdio: ["pipe", "inherit", "pipe"],
  });
  const failures: string[] = [];
  archive.stderr.on("data", (chunk: Buffer) => failures.push(chunk.toString()));
  extract.stderr.on("data", (chunk: Buffer) => failures.push(chunk.toString()));
  archive.stdout.pipe(extract.stdin);

  await Promise.all([
    new Promise<void>((done, fail) => {
      archive.on("close", (code) =>
        code === 0 ? done() : fail(new Error(failures.join("").trim() || "git archive failed")),
      );
      archive.on("error", fail);
    }),
    new Promise<void>((done, fail) => {
      extract.on("close", (code) =>
        code === 0 ? done() : fail(new Error(failures.join("").trim() || "tar failed")),
      );
      extract.on("error", fail);
    }),
  ]);
}

async function removeIfPresent(checkoutPath: string, path: string): Promise<boolean> {
  const absolute = join(checkoutPath, path);
  if (!resolve(absolute).startsWith(`${resolve(checkoutPath)}${sep}`)) {
    return false;
  }
  try {
    const info = await stat(absolute);
    if (info.isDirectory()) {
      return false;
    }
  } catch {
    return false;
  }
  await rm(absolute, { force: true });
  // Empty parents left behind would otherwise show as deleted directories in the workbench.
  let parent = dirname(absolute);
  const root = resolve(checkoutPath);
  while (resolve(parent) !== root && resolve(parent).startsWith(`${root}${sep}`)) {
    try {
      const entries = await stat(parent);
      if (!entries.isDirectory()) {
        return true;
      }
      await rm(parent, { recursive: false });
      parent = dirname(parent);
    } catch {
      return true;
    }
  }
  return true;
}

export async function applyTurnRestore(input: RestoreInput): Promise<RestoreResult> {
  const plan = await buildPlan(input);
  if (plan.failure) {
    return { restored: [], removed: [], failure: plan.failure };
  }

  const toRestore = plan.entries.filter((entry) => entry.change === "restore");
  try {
    await extractPaths(
      input,
      toRestore.map((entry) => entry.path),
    );
  } catch {
    return failureResult("git-failed", "写回文件失败，工作区可能只恢复了一部分。");
  }

  const removed: string[] = [];
  for (const entry of plan.entries) {
    if (entry.change !== "remove") {
      continue;
    }
    if (await removeIfPresent(input.checkoutPath, entry.path)) {
      removed.push(entry.path);
    }
  }

  return {
    restored: toRestore.map((entry) => entry.path),
    removed,
  };
}

function failureResult(code: RestoreFailureCode, message: string): RestoreResult {
  return { restored: [], removed: [], failure: { code, message } };
}
