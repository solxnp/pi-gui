import { useEffect, useState } from "react";
import type { PiDesktopApi } from "../../../contracts/ipc";
import type { TurnChangesResult } from "../../../contracts/review";
import type { SessionRecord, WorkspaceRecord } from "../../../contracts/desktop-state";
import { useTranslation } from "../../i18n";
import { currentTaskTitle, useTasksLedger } from "../workbench/tasks-board/use-tasks-ledger";

interface SessionOverviewProps {
  readonly api: PiDesktopApi | undefined;
  readonly workspace: Pick<WorkspaceRecord, "id" | "branchName">;
  readonly session: Pick<SessionRecord, "id" | "status">;
}

export interface TurnSummary {
  readonly files: number;
  readonly added: number;
  readonly removed: number;
}

/** Public for the unit spec: the strip shows the last turn only. */
export function summarizeTurn(result: TurnChangesResult): TurnSummary | null {
  if (result.state !== "available" || result.turns.length === 0) return null;
  const turn = result.turns[result.turns.length - 1];
  if (!turn || turn.files.length === 0) return null;
  let added = 0;
  let removed = 0;
  for (const file of turn.files) {
    added += file.lines?.added ?? 0;
    removed += file.lines?.removed ?? 0;
  }
  return { files: turn.files.length, added, removed };
}

/**
 * One line above the composer: branch, what the last turn changed, and the task
 * the workspace ledger names. Read-only — every action lives elsewhere.
 */
export function SessionOverview({ api, workspace, session }: SessionOverviewProps) {
  const { t } = useTranslation();
  const ledger = useTasksLedger(api, workspace.id);
  const [turn, setTurn] = useState<TurnSummary | null>(null);
  const sessionId = session.id;
  const sessionStatus = session.status;
  const workspaceId = workspace.id;

  useEffect(() => {
    if (!api) {
      setTurn(null);
      return;
    }
    let cancelled = false;
    // Refreshed when the turn starts or ends, so a finished run shows its own numbers.
    api
      .getTurnChanges({ target: { workspaceId, sessionId } })
      .then((result) => {
        if (!cancelled) setTurn(summarizeTurn(result));
      })
      .catch(() => {
        if (!cancelled) setTurn(null);
      });
    return () => {
      cancelled = true;
    };
  }, [api, workspaceId, sessionId, sessionStatus]);

  const task = ledger.state.kind === "ready" ? currentTaskTitle(ledger.state.board) : undefined;
  const branch = workspace.branchName;

  if (!branch && !turn && !task) return null;

  return (
    <div className="session-overview" data-testid="session-overview">
      {branch ? (
        <span className="session-overview__item session-overview__branch" title={branch}>
          <span aria-hidden="true">⎇ </span>
          {branch}
        </span>
      ) : null}
      {turn ? (
        <span className="session-overview__item" data-testid="session-overview-changes">
          {t("sessionOverview.changes", {
            files: turn.files,
            added: turn.added,
            removed: turn.removed,
          })}
        </span>
      ) : null}
      {task ? (
        <span
          className="session-overview__item session-overview__task"
          data-testid="session-overview-task"
          title={t("sessionOverview.task", { task })}
        >
          <span aria-hidden="true">📌 </span>
          {task}
        </span>
      ) : null}
    </div>
  );
}
