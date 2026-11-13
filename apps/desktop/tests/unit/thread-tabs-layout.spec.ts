import { expect, test } from "@playwright/test";
import { threadTabLayout, threadTabSlot } from "../../src/features/threads/thread-tabs";

/** 172px per tab slot (max 168px tab + 4px gap), so 1040px holds six. */
const STRIP = 6 * 172;

test("fills each row to capacity instead of evening the rows out", () => {
  // Seven tabs in a six-wide strip read 6 + 1, not 4 + 3: a wrap must never
  // happen while the first row still has room.
  expect(threadTabLayout(7, STRIP)).toEqual({ rows: 2, columns: 6 });
  expect(threadTabLayout(12, STRIP)).toEqual({ rows: 2, columns: 6 });
  expect(threadTabLayout(6, STRIP)).toEqual({ rows: 1, columns: 6 });
  expect(threadTabLayout(5, STRIP)).toEqual({ rows: 1, columns: 6 });
});

test("grows columns and scrolls sideways past the three-row cap", () => {
  // 19 tabs cannot fit three six-wide rows, so columns grow to seven and the
  // strip scrolls rather than pushing the transcript down.
  expect(threadTabLayout(19, STRIP)).toEqual({ rows: 3, columns: 7 });
  expect(threadTabLayout(18, STRIP)).toEqual({ rows: 3, columns: 6 });
});

test("keeps at least one tab per row on a narrow strip", () => {
  expect(threadTabLayout(3, 100)).toEqual({ rows: 3, columns: 1 });
  expect(threadTabLayout(0, STRIP)).toEqual({ rows: 0, columns: 0 });
});

test("places tabs left to right, then on the next row", () => {
  expect(threadTabSlot(0, 6)).toEqual({ row: 1, column: 1 });
  expect(threadTabSlot(5, 6)).toEqual({ row: 1, column: 6 });
  expect(threadTabSlot(6, 6)).toEqual({ row: 2, column: 1 });
});
