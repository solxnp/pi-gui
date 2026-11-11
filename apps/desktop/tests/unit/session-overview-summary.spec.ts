import { expect, test } from "@playwright/test";
import type { TurnChangesResult } from "../../contracts/review";
import { summarizeTurn } from "../../src/features/conversation/session-overview";

function turn(files: readonly (readonly [string, number | null, number | null])[]) {
  return {
    checkpointId: "c",
    checkoutId: "o",
    entryIds: ["e"],
    files: files.map(([path, added, removed]) => ({
      path,
      lines: added === null || removed === null ? null : { added, removed },
    })),
  };
}

test("sums the last turn only, so an older run cannot inflate the numbers", () => {
  const result: TurnChangesResult = {
    state: "available",
    turns: [
      turn([["a.ts", 100, 50]]),
      turn([
        ["b.ts", 3, 1],
        ["c.ts", 2, 0],
      ]),
    ],
  };
  expect(summarizeTurn(result)).toEqual({ files: 2, added: 5, removed: 1 });
});

test("binary files count as a changed file but contribute no lines", () => {
  const result: TurnChangesResult = {
    state: "available",
    turns: [
      turn([
        ["logo.png", null, null],
        ["d.ts", 4, 4],
      ]),
    ],
  };
  expect(summarizeTurn(result)).toEqual({ files: 2, added: 4, removed: 4 });
});

test("no turns, an empty turn, or an issue means the strip shows no change segment", () => {
  expect(summarizeTurn({ state: "available", turns: [] })).toBeNull();
  expect(summarizeTurn({ state: "available", turns: [turn([])] })).toBeNull();
  expect(
    summarizeTurn({ state: "unavailable", code: "review-failed", message: "nope" }),
  ).toBeNull();
});
