import { expect, test } from "@playwright/test";
import type { ListedTurnCheckpoint } from "../../electron/workbench/checkpoint-store";
import { createRewindService } from "../../electron/workbench/checkpoint-rewind-service";
import type { RestoreResult } from "../../electron/workbench/checkpoint-restore";

const target = { workspaceId: "ws", sessionId: "session" };

function turn(checkpointId: string, checkoutId = "checkout"): ListedTurnCheckpoint {
  return {
    state: "available",
    checkpointId,
    checkoutId,
    repositoryPath: "/store/objects.git",
    beforeTreeOid: "a".repeat(40),
    afterTreeOid: "b".repeat(40),
    capturedAt: "2026-11-11T01:00:00.000Z",
    coverage: { mode: "complete" } as ListedTurnCheckpoint["coverage"],
    entryIds: ["entry-1"],
  };
}

interface Harness {
  readonly runs: {
    beforeTreeOid: string;
    afterTreeOid: string;
    checkoutPath: string;
    paths?: readonly string[];
  }[];
  readonly service: ReturnType<typeof createRewindService>;
}

function createHarness(options: {
  turns?: readonly ListedTurnCheckpoint[];
  checkoutPath?: string | undefined;
  restoreResult?: (run: { beforeTreeOid: string }) => RestoreResult;
}): Harness {
  const runs: Harness["runs"] = [];
  const service = createRewindService({
    listTurns: async () => options.turns ?? [turn("turn-1")],
    resolveCheckoutPath: () =>
      "checkoutPath" in options ? options.checkoutPath : "/work/checkout",
    preview: async () => ({
      entries: [{ path: "a.txt", change: "restore", additions: 1, deletions: 1 }],
    }),
    restore: async (run) => {
      runs.push({
        paths: run.paths,
        beforeTreeOid: run.beforeTreeOid,
        afterTreeOid: run.afterTreeOid,
        checkoutPath: run.checkoutPath,
      });
      return options.restoreResult?.(run) ?? { restored: ["a.txt"], removed: ["c.txt"] };
    },
  });
  return { runs, service };
}

test("listing a session returns its captured turns", async () => {
  const { service } = createHarness({ turns: [turn("turn-1"), turn("turn-2")] });
  const points = await service.list(target);

  expect(points.map((point) => point.checkpointId)).toEqual(["turn-1", "turn-2"]);
  expect(points[0]?.entryIds).toEqual(["entry-1"]);
});

test("applying a rewind restores files and remembers it for undo", async () => {
  const { service, runs } = createHarness({});

  const applied = await service.apply(target, "turn-1");
  expect(applied.undoable).toBe(true);
  expect(applied.restored).toEqual(["a.txt"]);
  expect(runs[0]?.beforeTreeOid).toBe("a".repeat(40));

  const undone = await service.undo(target, "turn-1");
  expect(undone.undoable).toBe(false);
  // Undo runs the same restore with the trees swapped.
  expect(runs[1]?.beforeTreeOid).toBe("b".repeat(40));
  expect(runs[1]?.afterTreeOid).toBe("a".repeat(40));
  expect(runs[1]?.checkoutPath).toBe("/work/checkout");
});

test("undoing twice does nothing the second time", async () => {
  const { service, runs } = createHarness({});
  await service.apply(target, "turn-1");
  await service.undo(target, "turn-1");

  const again = await service.undo(target, "turn-1");
  expect(again.failure?.code).toBe("checkpoint-missing");
  expect(runs).toHaveLength(2);
});

test("a turn from another session or a missing checkout refuses", async () => {
  const unknownTurn = createHarness({ turns: [] });
  expect((await unknownTurn.service.apply(target, "turn-1")).failure?.code).toBe(
    "checkpoint-missing",
  );
  expect(unknownTurn.runs).toEqual([]);

  const goneCheckout = createHarness({ checkoutPath: undefined });
  const refused = await goneCheckout.service.apply(target, "turn-1");
  expect(refused.failure?.message).toContain("工作区");
  expect(goneCheckout.runs).toEqual([]);
});

test("a failed restore is not undoable", async () => {
  const { service } = createHarness({
    restoreResult: () => ({
      restored: [],
      removed: [],
      failure: { code: "git-failed", message: "写回失败" },
    }),
  });

  const applied = await service.apply(target, "turn-1");
  expect(applied.failure?.code).toBe("git-failed");
  expect(applied.undoable).toBe(false);
  expect((await service.undo(target, "turn-1")).failure?.code).toBe("checkpoint-missing");
});

test("the preview reports the same entries without applying anything", async () => {
  const { service, runs } = createHarness({});
  const preview = await service.preview(target, "turn-1");

  expect(preview.entries).toHaveLength(1);
  expect(preview.entries[0]?.path).toBe("a.txt");
  expect(runs).toEqual([]);
});

test("a scoped rewind and its undo both keep the scope", async () => {
  const { service, runs } = createHarness({});

  const applied = await service.apply(target, "turn-1", ["a.txt"]);
  expect(applied.undoable).toBe(true);
  expect(runs[0]?.paths).toEqual(["a.txt"]);

  await service.undo(target, "turn-1");
  // Undo replays the same files, so a partial rewind cannot revert untouched files.
  expect(runs[1]?.paths).toEqual(["a.txt"]);
});
