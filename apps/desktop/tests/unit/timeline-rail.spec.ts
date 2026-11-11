import { test, expect } from "@playwright/test";
import type { DisplayTimelineItem } from "../../contracts/timeline-types";
import { layoutRows, totalRowHeight } from "../../src/features/conversation/timeline-layout";
import {
  buildRailTicks,
  hasTimelineRail,
  previewText,
  TIMELINE_RAIL_MIN_TICKS,
} from "../../src/features/conversation/timeline-rail-model";
import { formatAnnotatedPrompt } from "../../src/features/conversation/annotations/annotation-prompt";
import { formatCrossProjectMessage } from "../../contracts/thread-message";

const prompt = (id: string, text = "prompt"): DisplayTimelineItem => ({
  kind: "message",
  id,
  role: "user",
  text,
  createdAt: "2026-09-19T00:00:00Z",
});
const reply = (id: string, text = "reply"): DisplayTimelineItem => ({
  kind: "message",
  id,
  role: "assistant",
  text,
  createdAt: "2026-09-19T00:00:01Z",
});
const activity = (id: string): DisplayTimelineItem => ({
  kind: "activity",
  id,
  label: "compacted",
  createdAt: "2026-09-19T00:00:02Z",
});

test("only the user's prompts become ticks, positioned by their share of the whole thread", () => {
  const items = [
    prompt("u1"),
    reply("a1"),
    prompt("u2"),
    activity("s1"),
    reply("a2"),
    prompt("u3"),
  ];
  const rows = layoutRows(
    items,
    new Map([
      ["u1", 100],
      ["a1", 200],
      ["u2", 100],
      ["s1", 40],
      ["a2", 200],
      ["u3", 100],
    ]),
    700,
  );
  const total = totalRowHeight(rows);
  const ticks = buildRailTicks(rows, total, 0);

  expect(ticks.map((tick) => tick.rowId)).toEqual(["u1", "u2", "u3"]);
  expect(ticks.map((tick) => tick.index)).toEqual([1, 2, 3]);
  expect(ticks.map((tick) => tick.fraction)).toEqual(
    rows.filter((row) => row.item.id.startsWith("u")).map((row) => row.top / total),
  );
  expect(ticks[0]!.fraction).toBe(0);
  expect(ticks.every((tick) => tick.fraction >= 0 && tick.fraction <= 1)).toBe(true);
});

test("the prompt at or above the reading position is the current one", () => {
  const rows = layoutRows([prompt("u1"), reply("a1"), prompt("u2"), reply("a2")], new Map(), 700);
  const second = rows.find((row) => row.item.id === "u2")!;
  const third = rows.length;

  expect(buildRailTicks(rows, totalRowHeight(rows), 0).map((tick) => tick.active)).toEqual([
    true,
    false,
  ]);
  expect(
    buildRailTicks(rows, totalRowHeight(rows), second.top + 4).map((tick) => tick.active),
  ).toEqual([false, true]);
  // Reading the bottom of the thread keeps the last prompt current.
  expect(
    buildRailTicks(rows, totalRowHeight(rows), totalRowHeight(rows)).map((tick) => tick.active),
  ).toEqual([false, true]);
  // A measured-short tail leaves the last row's top past the real maximum scroll, so the
  // bottom is decided by following state, not by comparing tops.
  expect(
    buildRailTicks(rows, totalRowHeight(rows), second.top, true).map((tick) => tick.active),
  ).toEqual([false, true]);
  expect(third).toBe(4);
});

test("a thread with one prompt is left alone", () => {
  const rows = layoutRows([prompt("u1"), reply("a1")], new Map(), 700);
  const ticks = buildRailTicks(rows, totalRowHeight(rows), 0);
  expect(ticks).toHaveLength(1);
  expect(TIMELINE_RAIL_MIN_TICKS).toBe(2);
  expect(hasTimelineRail(ticks)).toBe(false);
  expect(hasTimelineRail([...ticks, ...ticks])).toBe(true);
});

test("previews read the prompt itself, not the wrapper syntax around it", () => {
  expect(previewText(prompt("u1", "  Fix the\r\n\r\n  deploy script "))).toBe(
    "Fix the deploy script",
  );
  expect(
    previewText(
      prompt(
        "u2",
        formatCrossProjectMessage({ project: "pi-gui-dev", threadId: "t-1" }, "Ship it"),
      ),
    ),
  ).toBe("Ship it");
  expect(
    previewText(
      prompt("u3", formatAnnotatedPrompt([{ quote: "line 7", note: "why?" }], "Answer this")),
    ),
  ).toBe("Answer this");
  // A quote-only annotation still previews the quoted text instead of the tags.
  expect(
    previewText(prompt("u4", formatAnnotatedPrompt([{ quote: "line 7", note: "" }], ""))),
  ).toBe("line 7");
  const long = previewText(prompt("u5", "word ".repeat(80)));
  expect(long.endsWith("…")).toBe(true);
  expect(long.length).toBeLessThanOrEqual(161);
  expect(
    previewText({
      ...prompt("u6", ""),
      attachments: [{ kind: "image", mimeType: "image/png", data: "AAAA" }],
    }),
  ).toBe("Image attachment");
  expect(previewText(prompt("u7", ""))).toBe("Empty message");
});
