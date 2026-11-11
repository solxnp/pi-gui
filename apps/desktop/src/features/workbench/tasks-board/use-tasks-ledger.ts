import { useCallback, useEffect, useRef, useState } from "react";
import type { PiDesktopApi } from "../../../../contracts/ipc";
import { useTranslation } from "../../../i18n";
import { parseTasksBoard, TASKS_BOARD_FILES, type TasksBoard } from "./parse-tasks";

export interface TasksProjectCount {
  readonly doing: number;
  readonly todo: number;
  readonly done: number;
  readonly cancelled: number;
}

/** At most this many projects are read for the overview; the rest keep their place in the list. */
export const MAX_LEDGER_PROJECTS = 12;

export type TasksLedgerState =
  | { readonly kind: "loading" }
  | { readonly kind: "missing" }
  | { readonly kind: "error"; readonly message: string }
  | {
      readonly kind: "ready";
      readonly path: string;
      readonly board: TasksBoard;
      readonly truncated: boolean;
      /** Lets a write refuse to clobber an edit that landed after this read. */
      readonly modifiedAtMs?: number;
    };

const MISSING_FILE = /ENOENT|no such file|not found/i;

/** Reads the workspace task ledger; the side panel and the composer overview share it. */
export function useTasksLedger(
  api: PiDesktopApi | undefined,
  workspaceId: string,
): { readonly state: TasksLedgerState; readonly reload: () => void } {
  const { t } = useTranslation();
  const [state, setState] = useState<TasksLedgerState>({ kind: "loading" });
  const [reloadToken, setReloadToken] = useState(0);
  const requestId = useRef(0);

  useEffect(() => {
    if (!api || !workspaceId) {
      setState({ kind: "missing" });
      return;
    }
    const current = ++requestId.current;
    setState({ kind: "loading" });
    (async () => {
      let missing = true;
      let failure = "";
      for (const path of TASKS_BOARD_FILES) {
        try {
          const preview = await api.readWorkspaceFile(workspaceId, path);
          if (current !== requestId.current) return;
          if (preview.binary) {
            missing = false;
            failure = t("tasksBoard.binary", { path });
            continue;
          }
          setState({
            kind: "ready",
            path,
            board: parseTasksBoard(preview.content),
            truncated: preview.truncated,
            modifiedAtMs: preview.modifiedAtMs,
          });
          return;
        } catch (error) {
          if (current !== requestId.current) return;
          const message = error instanceof Error ? error.message : String(error);
          if (!MISSING_FILE.test(message)) {
            missing = false;
            failure = t("tasksBoard.readFailed", { path, message });
          }
        }
      }
      setState(missing && !failure ? { kind: "missing" } : { kind: "error", message: failure });
    })().catch(() => {
      // Read failures are reported as state; the hook never rejects on its own.
    });
  }, [api, workspaceId, reloadToken, t]);

  const reload = useCallback(() => setReloadToken((token) => token + 1), []);
  return { state, reload };
}

/** The row the overview line names: first in-progress group, else the first open one. */
export function currentTaskTitle(board: TasksBoard): string | undefined {
  return (
    board.groups.find((group) => group.status === "doing")?.title ??
    board.groups.find((group) => group.status === "todo")?.title
  );
}

/** Counts one board's groups by status, so the project switcher can show them. */
export function countBoard(board: TasksBoard): TasksProjectCount {
  const counts = { doing: 0, todo: 0, done: 0, cancelled: 0 };
  for (const group of board.groups) counts[group.status] += 1;
  return counts;
}

/**
 * Reads every root workspace's ledger once, in series, so the switcher can show
 * per-project counts without opening each project.
 */
export function useTasksProjectCounts(
  api: PiDesktopApi | undefined,
  workspaceIds: readonly string[],
): Readonly<Record<string, TasksProjectCount>> {
  const [counts, setCounts] = useState<Readonly<Record<string, TasksProjectCount>>>({});
  const key = workspaceIds.slice(0, MAX_LEDGER_PROJECTS).join("\n");

  useEffect(() => {
    const ids = key ? key.split("\n") : [];
    if (!api || ids.length === 0) {
      setCounts({});
      return;
    }
    let cancelled = false;
    (async () => {
      const next: Record<string, TasksProjectCount> = {};
      for (const workspaceId of ids) {
        for (const path of TASKS_BOARD_FILES) {
          try {
            const preview = await api.readWorkspaceFile(workspaceId, path);
            if (cancelled) return;
            if (preview.binary) continue;
            next[workspaceId] = countBoard(parseTasksBoard(preview.content));
            break;
          } catch {
            // Missing files are the normal case for projects without a ledger.
          }
        }
      }
      if (!cancelled) setCounts(next);
    })().catch(() => {
      // A failed overview read leaves the switcher without numbers; it never throws.
    });
    return () => {
      cancelled = true;
    };
  }, [api, key]);

  return counts;
}
