/**
 * `~/.pi/agent/recall.json` — the project list the user-level `recall` extension searches.
 *
 * The file belongs to pi, not to this app's own userData, and people hand-edit it. So the service
 * keeps unknown top-level keys (`"//"` comments, future fields) on save, writes beside the target
 * and renames, and leaves a `.bak` behind when the existing file is not parseable — a save from the
 * settings page must never be the reason a hand-written config disappears.
 *
 * Validation lives here rather than in the renderer: a path that does not exist, or a session
 * directory that is not under `sessions/`, makes the extension silently miss that project.
 */

import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join } from "node:path";
import type {
  RecallConfigProblem,
  RecallProjectEntry,
  RecallProjectsProblem,
  RecallProjectsSnapshot,
} from "../../contracts/ipc";
import { resolvePiAgentDir } from "./agent-dir";

export const recallConfigFileName = "recall.json";

/** Each entry is three short strings; these caps keep a pasted blob from becoming a config. */
const NAME_LIMIT = 60;
const PATH_LIMIT = 1024;
const SESSION_DIR_LIMIT = 200;
const MAX_ENTRIES = 200;

export class RecallProjectsRejected extends Error {
  readonly problems: readonly RecallProjectsProblem[];

  constructor(problems: readonly RecallProjectsProblem[]) {
    super("The recall project list was rejected.");
    this.name = "RecallProjectsRejected";
    this.problems = problems;
  }
}

export interface RecallProjectsService {
  /** Absolute path of the file the settings page shows and edits. */
  readonly path: string;
  read(): Promise<RecallProjectsSnapshot>;
  /** Validates, then saves; throws `RecallProjectsRejected` when an entry is unusable. */
  save(projects: unknown): Promise<RecallProjectsSnapshot>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function trimmed(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** Only the fields the extension reads; anything else in an entry is dropped on save. */
function toEntry(record: Record<string, unknown>): RecallProjectEntry | undefined {
  const name = trimmed(record.name);
  const path = trimmed(record.path);
  if (!name || !path) {
    return undefined;
  }
  const sessionDir = trimmed(record.sessionDir);
  const note = trimmed(record.note);
  return {
    name,
    path,
    ...(sessionDir ? { sessionDir } : {}),
    ...(note ? { note } : {}),
  };
}

async function readSnapshot(configPath: string): Promise<RecallProjectsSnapshot> {
  let raw: string;
  try {
    raw = await readFile(configPath, "utf8");
  } catch {
    // No file yet: an empty list, not an error — the page can create the first entry.
    return { path: configPath, projects: [] };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { path: configPath, projects: [], problem: "invalidJson" satisfies RecallConfigProblem };
  }
  if (!isRecord(parsed) || !Array.isArray(parsed.projects)) {
    return {
      path: configPath,
      projects: [],
      problem: "invalidShape" satisfies RecallConfigProblem,
    };
  }

  const projects: RecallProjectEntry[] = [];
  for (const item of parsed.projects) {
    if (!isRecord(item)) {
      continue;
    }
    const entry = toEntry(item);
    if (entry) {
      projects.push(entry);
    }
  }
  return { path: configPath, projects };
}

async function inspect(
  raw: unknown,
  sessionsDir: string,
): Promise<{ problems: RecallProjectsProblem[]; entries: RecallProjectEntry[] }> {
  if (!Array.isArray(raw)) {
    return { problems: [{ code: "notAList" }], entries: [] };
  }
  if (raw.length > MAX_ENTRIES) {
    return { problems: [{ code: "tooManyEntries" }], entries: [] };
  }

  const problems: RecallProjectsProblem[] = [];
  const entries: RecallProjectEntry[] = [];
  const seen = new Map<string, number>();

  for (const [index, item] of raw.entries()) {
    if (!isRecord(item)) {
      problems.push({ code: "notAnObject", index });
      continue;
    }

    const name = trimmed(item.name);
    const projectPath = trimmed(item.path);
    const sessionDir = trimmed(item.sessionDir);
    const note = trimmed(item.note);

    if (!name) {
      problems.push({ code: "nameEmpty", index });
    } else if (name.length > NAME_LIMIT) {
      problems.push({ code: "nameTooLong", index });
    } else {
      const key = name.toLowerCase();
      const firstIndex = seen.get(key);
      if (firstIndex === undefined) {
        seen.set(key, index);
      } else {
        problems.push({ code: "nameDuplicate", index, value: name, firstIndex });
      }
    }

    if (!projectPath) {
      problems.push({ code: "pathMissing", index });
    } else if (!isAbsolute(projectPath)) {
      problems.push({ code: "pathNotAbsolute", index });
    } else if (projectPath.length > PATH_LIMIT) {
      problems.push({ code: "pathTooLong", index });
    } else {
      const info = await stat(projectPath).catch(() => undefined);
      if (!info) {
        problems.push({ code: "pathMissing", index, value: projectPath });
      } else if (!info.isDirectory()) {
        problems.push({ code: "pathNotDirectory", index, value: projectPath });
      }
    }

    if (sessionDir) {
      if (
        sessionDir.length > SESSION_DIR_LIMIT ||
        sessionDir.includes("/") ||
        sessionDir.includes("\\")
      ) {
        problems.push({ code: "sessionDirInvalid", index });
      } else {
        const info = await stat(join(sessionsDir, sessionDir)).catch(() => undefined);
        if (!info?.isDirectory()) {
          problems.push({ code: "sessionDirMissing", index, value: sessionDir });
        }
      }
    }

    if (problems.length > 0 && problems.some((problem) => problem.index === index)) {
      continue;
    }
    entries.push({
      name,
      path: projectPath,
      ...(sessionDir ? { sessionDir } : {}),
      ...(note ? { note } : {}),
    });
  }

  return { problems, entries };
}

export function recallConfigPath(agentDir = resolvePiAgentDir()): string {
  return join(agentDir, recallConfigFileName);
}

export function createRecallProjectsService(
  configPath = recallConfigPath(),
): RecallProjectsService {
  const sessionsDir = join(dirname(configPath), "sessions");

  return {
    path: configPath,

    read: () => readSnapshot(configPath),

    save: async (projects: unknown) => {
      const { problems, entries } = await inspect(projects, sessionsDir);
      if (problems.length > 0) {
        throw new RecallProjectsRejected(problems);
      }

      // Keep whatever else the file carried (`"//"` notes, fields added by a later version).
      const extras: Record<string, unknown> = {};
      let previous: string | undefined;
      try {
        previous = await readFile(configPath, "utf8");
      } catch {
        previous = undefined;
      }
      if (previous !== undefined) {
        try {
          const parsed: unknown = JSON.parse(previous);
          if (isRecord(parsed)) {
            for (const [key, value] of Object.entries(parsed)) {
              if (key !== "projects") {
                extras[key] = value;
              }
            }
          }
        } catch {
          await writeFile(`${configPath}.bak`, previous, { encoding: "utf8", mode: 0o600 });
        }
      }

      const body = `${JSON.stringify({ ...extras, projects: entries }, null, 2)}\n`;
      await mkdir(dirname(configPath), { recursive: true });
      // Write beside the target and rename, so an interrupted save cannot truncate the config.
      const temporary = `${configPath}.tmp`;
      await writeFile(temporary, body, { encoding: "utf8", mode: 0o600 });
      await rename(temporary, configPath);

      return readSnapshot(configPath);
    },
  };
}
