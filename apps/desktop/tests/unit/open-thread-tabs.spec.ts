import { expect, test } from "@playwright/test";
import {
  MAX_OPEN_THREAD_TABS,
  closeThreadTab,
  openThreadTab,
  reconcileOpenThreadTabs,
  threadTabAt,
  threadTabKey,
  threadTabNeighbor,
} from "../../contracts/open-thread-tabs";

const a = { workspaceId: "ws", sessionId: "a" };
const b = { workspaceId: "ws", sessionId: "b" };
const c = { workspaceId: "other", sessionId: "c" };

test("opening a conversation appends it once and keeps its place on re-open", () => {
  const once = openThreadTab([], a);
  expect(once).toEqual([a]);
  const twice = openThreadTab(openThreadTab(once, b), a);
  expect(twice).toEqual([a, b]);
  // A same-keyed but distinct record still counts as the same tab.
  expect(openThreadTab(twice, { workspaceId: "ws", sessionId: "a" })).toBe(twice);
});

test("the strip is bounded so a corrupt list cannot grow without limit", () => {
  let tabs: readonly { workspaceId: string; sessionId: string }[] = [];
  for (let index = 0; index < MAX_OPEN_THREAD_TABS + 5; index += 1) {
    tabs = openThreadTab(tabs, { workspaceId: "ws", sessionId: `s${index}` });
  }
  expect(tabs).toHaveLength(MAX_OPEN_THREAD_TABS);
  expect(tabs[0]).toEqual({ workspaceId: "ws", sessionId: "s5" });
});

test("closing removes only that tab and can leave the strip empty", () => {
  expect(closeThreadTab([a, b, c], b)).toEqual([a, c]);
  expect(closeThreadTab([a], a)).toEqual([]);
  expect(closeThreadTab([a], { workspaceId: "ws", sessionId: "missing" })).toEqual([a]);
});

test("the next tab to select is the right neighbour, else the left one", () => {
  expect(threadTabNeighbor([a, b, c], b)).toEqual(c);
  expect(threadTabNeighbor([a, b, c], c)).toEqual(b);
  expect(threadTabNeighbor([a], a)).toBeUndefined();
  expect(threadTabNeighbor([a, b], { workspaceId: "ws", sessionId: "missing" })).toBeUndefined();
});

test("tabs whose conversation is gone are dropped and duplicates collapse", () => {
  const live = new Set(["ws:a", "other:c"]);
  expect(reconcileOpenThreadTabs([a, b, c, a], (key) => live.has(key))).toEqual([a, c]);
  expect(reconcileOpenThreadTabs([], () => true)).toEqual([]);
});

test("a shortcut slot selects tabs in strip order, one-based", () => {
  expect(threadTabAt([a, b, c], 1)).toEqual(a);
  expect(threadTabAt([a, b, c], 3)).toEqual(c);
  expect(threadTabAt([a], 2)).toBeUndefined();
  expect(threadTabAt([a], 0)).toBeUndefined();
  expect(threadTabKey(c)).toBe("other:c");
});
