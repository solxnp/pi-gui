import { useCallback, useState } from "react";
import type { TurnChangeSummary } from "../../../../contracts/review";
import type { RewindConfirmState } from "../rewind-confirm-dialog";

export interface RewindOutcome {
  readonly restored: number;
  readonly removed: number;
}

interface TurnRewindOptions {
  readonly workspaceId: string;
  readonly sessionId: string;
  readonly preview: (
    workspaceId: string,
    sessionId: string,
    checkpointId: string,
  ) => Promise<{
    entries: readonly {
      path: string;
      change: "restore" | "remove";
      additions: number;
      deletions: number;
    }[];
    failure?: { message: string };
  }>;
  readonly apply: (
    workspaceId: string,
    sessionId: string,
    checkpointId: string,
  ) => Promise<{
    restored: readonly string[];
    removed: readonly string[];
    failure?: { message: string };
  }>;
  readonly undo: (
    workspaceId: string,
    sessionId: string,
    checkpointId: string,
  ) => Promise<{
    restored: readonly string[];
    removed: readonly string[];
    failure?: { message: string };
  }>;
}

/**
 * The rewind flow for one thread: ask for the plan, show it, apply it, and remember what landed so
 * the card can offer one undo. Failures stay in the dialog instead of becoming a silent no-op.
 */
export function useTurnRewind(options: TurnRewindOptions | undefined) {
  const [confirm, setConfirm] = useState<RewindConfirmState | null>(null);
  const [outcomes, setOutcomes] = useState<Readonly<Record<string, RewindOutcome>>>({});
  const [error, setError] = useState<string | null>(null);

  const rememberOutcome = useCallback((checkpointId: string, outcome: RewindOutcome | null) => {
    setOutcomes((current) => {
      const next = { ...current };
      if (outcome) {
        next[checkpointId] = outcome;
      } else {
        delete next[checkpointId];
      }
      return next;
    });
  }, []);

  const requestRewind = useCallback(
    (turn: TurnChangeSummary) => {
      if (!options) {
        return;
      }
      setError(null);
      setConfirm({ checkpointId: turn.checkpointId, loading: true, entries: [] });
      void options
        .preview(options.workspaceId, options.sessionId, turn.checkpointId)
        .then((result) => {
          setConfirm((current) =>
            current && current.checkpointId === turn.checkpointId
              ? {
                  checkpointId: turn.checkpointId,
                  loading: false,
                  entries: result.entries,
                  failure: result.failure?.message,
                }
              : current,
          );
        })
        .catch(() => {
          setConfirm((current) =>
            current && current.checkpointId === turn.checkpointId
              ? {
                  checkpointId: turn.checkpointId,
                  loading: false,
                  entries: [],
                  failure: "读取回退预览失败。",
                }
              : current,
          );
        });
    },
    [options],
  );

  const cancelRewind = useCallback(() => setConfirm(null), []);

  const confirmRewind = useCallback(() => {
    if (!options || !confirm) {
      return;
    }
    const checkpointId = confirm.checkpointId;
    void options
      .apply(options.workspaceId, options.sessionId, checkpointId)
      .then((result) => {
        if (result.failure) {
          setConfirm((current) =>
            current ? { ...current, failure: result.failure?.message } : current,
          );
          return;
        }
        setConfirm(null);
        rememberOutcome(checkpointId, {
          restored: result.restored.length,
          removed: result.removed.length,
        });
      })
      .catch(() => setError("执行回退失败。"));
  }, [confirm, options, rememberOutcome]);

  const undoRewind = useCallback(
    (checkpointId: string) => {
      if (!options) {
        return;
      }
      void options
        .undo(options.workspaceId, options.sessionId, checkpointId)
        .then((result) => {
          if (result.failure) {
            setError(result.failure.message);
            return;
          }
          rememberOutcome(checkpointId, null);
        })
        .catch(() => setError("撤销回退失败。"));
    },
    [options, rememberOutcome],
  );

  return { confirm, outcomes, error, requestRewind, confirmRewind, cancelRewind, undoRewind };
}
