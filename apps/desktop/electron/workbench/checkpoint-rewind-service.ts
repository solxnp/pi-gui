/**
 * Rewind bookkeeping between the captured turns and the restore primitives.
 *
 * This module owns two things the restore layer deliberately does not: which checkout a turn
 * belongs to, and the one-step undo of an applied restore. Nothing here touches disk directly, so
 * the ordering rules are testable without Git or Electron.
 *
 * Undo needs no new storage: a turn's two trees are symmetric, so undoing an applied restore is the
 * same restore run with the trees swapped.
 */

import type { ListedTurnCheckpoint } from "./checkpoint-store";
import type { RestoreEntry, RestoreFailure, RestoreResult } from "./checkpoint-restore";

export interface RewindTarget {
  readonly workspaceId: string;
  readonly sessionId: string;
}

export interface RewindPoint {
  readonly checkpointId: string;
  readonly checkoutId: string;
  readonly capturedAt: string;
  /** Transcript entries of the turn, so the UI can place the point in the conversation. */
  readonly entryIds: readonly string[];
}

export interface RewindPreviewResult {
  readonly entries: readonly RestoreEntry[];
  readonly failure?: RestoreFailure;
}

export interface RewindUndoRecord {
  readonly checkpointId: string;
  readonly restored: number;
  readonly removed: number;
}

export interface RewindApplyResult {
  readonly restored: readonly string[];
  readonly removed: readonly string[];
  readonly undoable: boolean;
  readonly failure?: RestoreFailure;
}

interface RestoreRun {
  readonly repositoryPath: string;
  readonly checkoutPath: string;
  readonly beforeTreeOid: string;
  readonly afterTreeOid: string;
  readonly paths?: readonly string[];
}

export interface RewindServiceDeps {
  readonly listTurns: (target: RewindTarget) => Promise<readonly ListedTurnCheckpoint[]>;
  /** The working tree a capture belongs to; undefined when that checkout is gone. */
  readonly resolveCheckoutPath: (checkoutId: string) => string | undefined;
  readonly preview: (run: RestoreRun) => Promise<{
    readonly entries: readonly RestoreEntry[];
    readonly failure?: RestoreFailure;
  }>;
  readonly restore: (run: RestoreRun) => Promise<RestoreResult>;
}

export interface RewindService {
  list(target: RewindTarget): Promise<readonly RewindPoint[]>;
  preview(target: RewindTarget, checkpointId: string): Promise<RewindPreviewResult>;
  apply(
    target: RewindTarget,
    checkpointId: string,
    paths?: readonly string[],
  ): Promise<RewindApplyResult>;
  undo(target: RewindTarget, checkpointId: string): Promise<RewindApplyResult>;
  /** Applied rewinds still open for undo, so a reopened thread can offer the button again. */
  applied(target: RewindTarget): Promise<readonly RewindUndoRecord[]>;
}

function refusal(message: string): RewindApplyResult {
  return {
    restored: [],
    removed: [],
    undoable: false,
    failure: { code: "checkpoint-missing", message },
  };
}

export function createRewindService(deps: RewindServiceDeps): RewindService {
  /** Applied restores awaiting undo, keyed by session and turn. One level, as the UI offers one. */
  const applied = new Map<string, RestoreRun & { restored: number; removed: number }>();

  const keyOf = (target: RewindTarget, checkpointId: string): string =>
    `${target.workspaceId}\u0000${target.sessionId}\u0000${checkpointId}`;

  const runFor = async (
    target: RewindTarget,
    checkpointId: string,
  ): Promise<RestoreRun | RewindApplyResult> => {
    const turns = await deps.listTurns(target);
    const turn = turns.find((candidate) => candidate.checkpointId === checkpointId);
    if (!turn) {
      return refusal("这一轮没有可用的快照，无法回退。");
    }
    const checkoutPath = deps.resolveCheckoutPath(turn.checkoutId);
    if (!checkoutPath) {
      return refusal("这一轮所属的工作区已经不在了，回退已取消。");
    }
    return {
      repositoryPath: turn.repositoryPath,
      checkoutPath,
      beforeTreeOid: turn.beforeTreeOid,
      afterTreeOid: turn.afterTreeOid,
    };
  };

  const isResult = (value: RestoreRun | RewindApplyResult): value is RewindApplyResult =>
    "undoable" in value || "failure" in value;

  return {
    async list(target) {
      const turns = await deps.listTurns(target);
      return turns.map((turn) => ({
        checkpointId: turn.checkpointId,
        checkoutId: turn.checkoutId,
        capturedAt: turn.capturedAt,
        entryIds: turn.entryIds,
      }));
    },

    async preview(target, checkpointId) {
      const run = await runFor(target, checkpointId);
      if (isResult(run)) {
        return { entries: [], failure: run.failure };
      }
      return deps.preview(run);
    },

    async apply(target, checkpointId, paths) {
      const run = await runFor(target, checkpointId);
      if (isResult(run)) {
        return run;
      }
      const scoped = paths && paths.length > 0 ? { ...run, paths } : run;
      const result = await deps.restore(scoped);
      if (result.failure) {
        return { restored: [], removed: [], undoable: false, failure: result.failure };
      }
      // Undo replays the same path scope: a partial rewind must not revert untouched files.
      applied.set(keyOf(target, checkpointId), {
        ...scoped,
        restored: result.restored.length,
        removed: result.removed.length,
      });
      return { restored: result.restored, removed: result.removed, undoable: true };
    },

    async applied(target) {
      const prefix = `${target.workspaceId}\u0000${target.sessionId}\u0000`;
      const records: RewindUndoRecord[] = [];
      for (const [key, run] of applied) {
        if (!key.startsWith(prefix)) {
          continue;
        }
        records.push({
          checkpointId: key.slice(prefix.length),
          restored: run.restored,
          removed: run.removed,
        });
      }
      return records;
    },

    async undo(target, checkpointId) {
      const key = keyOf(target, checkpointId);
      const original = applied.get(key);
      if (!original) {
        return refusal("这一次回退已经撤销过，或者没有再可以撤销的动作。");
      }
      // The turn's trees are symmetric, so the undo is the same restore in the other direction.
      const result = await deps.restore({
        ...original,
        beforeTreeOid: original.afterTreeOid,
        afterTreeOid: original.beforeTreeOid,
      });
      if (result.failure) {
        return { restored: [], removed: [], undoable: false, failure: result.failure };
      }
      applied.delete(key);
      return { restored: result.restored, removed: result.removed, undoable: false };
    },
  };
}
