import { useCallback, useEffect, useRef, useState } from "react";
import type { PiDesktopApi } from "../../../../contracts/ipc";
import { useTranslation } from "../../../i18n";
import { parseTasksBoard, TASKS_BOARD_FILES, type TasksBoard } from "./parse-tasks";

export type TasksLedgerState =
  | { readonly kind: "loading" }
  | { readonly kind: "missing" }
  | { readonly kind: "error"; readonly message: string }
  | {
      readonly kind: "ready";
      readonly path: string;
      readonly board: TasksBoard;
      readonly truncated: boolean;
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
