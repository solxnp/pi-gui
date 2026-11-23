import { expect, test } from "@playwright/test";
import { delayOrAbort } from "../../electron/orchestration/wait-abort";

test("resolves after the delay when nothing cancels it", async () => {
  const started = Date.now();
  await delayOrAbort(120);
  expect(Date.now() - started).toBeGreaterThanOrEqual(100);
});

test("a stop cuts the sleep short instead of waiting out the deadline", async () => {
  const controller = new AbortController();
  const started = Date.now();
  const waiting = delayOrAbort(30_000, controller.signal);
  setTimeout(() => controller.abort(), 20);
  await waiting;
  // Without the abort path this would take 30 seconds, not tens of milliseconds.
  expect(Date.now() - started).toBeLessThan(2_000);
});

test("an already-cancelled signal resolves immediately", async () => {
  const controller = new AbortController();
  controller.abort();
  const started = Date.now();
  await delayOrAbort(30_000, controller.signal);
  expect(Date.now() - started).toBeLessThan(200);
});
