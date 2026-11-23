import { expect, test } from "@playwright/test";
import {
  currentActivity,
  describePinFreshness,
  PIN_STALE_AFTER_MS,
  shouldWarnStale,
} from "../../src/features/extensions/pinned-card-freshness";

const NOW = Date.parse("2026-11-23T08:00:00.000Z");

test("counts whole minutes since the card was written", () => {
  expect(describePinFreshness("2026-11-23T07:59:30.000Z", NOW).minutes).toBe(0);
  expect(describePinFreshness("2026-11-23T07:58:00.000Z", NOW).minutes).toBe(2);
  expect(describePinFreshness("2026-11-23T07:30:00.000Z", NOW).minutes).toBe(30);
});

test("only turns stale after the threshold, so a fresh card is not warned about", () => {
  const justUnder = new Date(NOW - PIN_STALE_AFTER_MS + 1000).toISOString();
  const justOver = new Date(NOW - PIN_STALE_AFTER_MS).toISOString();
  expect(describePinFreshness(justUnder, NOW).stale).toBe(false);
  expect(describePinFreshness(justOver, NOW).stale).toBe(true);
});

test("an unreadable timestamp reads as stale instead of fresh", () => {
  // Better a warning than a card that claims to be current because its time could not be read.
  const freshness = describePinFreshness("not-a-date", NOW);
  expect(freshness.stale).toBe(true);
  expect(Number.isFinite(freshness.minutes)).toBe(false);
});

test("the clock never runs backwards for a card written in the future", () => {
  const future = new Date(NOW + 60_000).toISOString();
  expect(describePinFreshness(future, NOW)).toEqual({ minutes: 0, stale: false });
});

test("current activity prefers a tool call still in flight, and marks it live", () => {
  const rows = [
    { kind: "message", label: "hi" },
    { kind: "tool", status: "success", label: "Ran bash: ls" },
    { kind: "tool", status: "running", label: "Ran bash: adb shell" },
    { kind: "message", label: "thinking" },
  ];
  expect(currentActivity(rows)).toEqual({ label: "Ran bash: adb shell", live: true });
});

test("falls back to the newest finished tool but never calls it live", () => {
  // Calling a finished call "running" is the false reassurance this feature exists to remove:
  // while the model thinks, the newest tool can be minutes old.
  expect(
    currentActivity([
      { kind: "tool", status: "success", label: "first" },
      { kind: "tool", status: "success", label: "second" },
      { kind: "message", label: "text" },
    ]),
  ).toEqual({ label: "second", live: false });
  expect(currentActivity([{ kind: "message", label: "only text" }])).toBeUndefined();
  expect(currentActivity([])).toBeUndefined();
});

test("warns only when the card is old AND the run is still going", () => {
  const old = new Date(NOW - 10 * 60_000).toISOString();
  const fresh = new Date(NOW - 10_000).toISOString();
  // Old but idle: the work finished, so an old card is correct, not stale.
  expect(shouldWarnStale(old, NOW, false)).toBe(false);
  // Old and running: this is the case the user was staring at — 0% for ten minutes.
  expect(shouldWarnStale(old, NOW, true)).toBe(true);
  // Fresh and running: nothing to warn about.
  expect(shouldWarnStale(fresh, NOW, true)).toBe(false);
  expect(shouldWarnStale(fresh, NOW, false)).toBe(false);
});

test("a row without a label produces no activity line at all", () => {
  // Rendering "now:" with nothing after it is worse than showing no activity.
  expect(currentActivity([{ kind: "tool", status: "running", label: "" }])).toBeUndefined();
  expect(currentActivity([{ kind: "tool", status: "success" }])).toBeUndefined();
});
