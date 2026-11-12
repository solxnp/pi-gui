/*
 * The window's open-thread tabs: which conversations are open like IDE tabs.
 * Pure list logic so main (storage) and the renderer (tab bar, ⌘1-9) agree on
 * the same order, and so the rules are testable without a window.
 */
import type { WorkspaceSessionTarget } from "./desktop-state";

/** Upper bound on open tabs; the tab bar scrolls, this only bounds a corrupt list. */
export const MAX_OPEN_THREAD_TABS = 40;

/** The identity of one conversation across workspace and session ids. */
export function threadTabKey(target: WorkspaceSessionTarget): string {
  return `${target.workspaceId}:${target.sessionId}`;
}

function sameTarget(left: WorkspaceSessionTarget, right: WorkspaceSessionTarget): boolean {
  return left.workspaceId === right.workspaceId && left.sessionId === right.sessionId;
}

/**
 * Adds a conversation to the end of the strip. Opening one that is already open
 * keeps its place, so ⌘1-9 stays stable while threads are re-selected.
 */
export function openThreadTab(
  tabs: readonly WorkspaceSessionTarget[],
  target: WorkspaceSessionTarget,
): readonly WorkspaceSessionTarget[] {
  if (tabs.some((tab) => sameTarget(tab, target))) {
    return tabs;
  }
  const next = [...tabs, { workspaceId: target.workspaceId, sessionId: target.sessionId }];
  return next.length > MAX_OPEN_THREAD_TABS ? next.slice(-MAX_OPEN_THREAD_TABS) : next;
}

/** Removes a conversation from the strip; unknown targets leave it untouched. */
export function closeThreadTab(
  tabs: readonly WorkspaceSessionTarget[],
  target: WorkspaceSessionTarget,
): readonly WorkspaceSessionTarget[] {
  return tabs.filter((tab) => !sameTarget(tab, target));
}

/**
 * The tab to select after closing one: the next tab to the right, else the one
 * to the left, else nothing (the window falls back to a new thread).
 */
export function threadTabNeighbor(
  tabs: readonly WorkspaceSessionTarget[],
  target: WorkspaceSessionTarget,
): WorkspaceSessionTarget | undefined {
  const index = tabs.findIndex((tab) => sameTarget(tab, target));
  if (index < 0) return undefined;
  return tabs[index + 1] ?? tabs[index - 1];
}

/**
 * Drops tabs whose conversation no longer exists (deleted, archived, or its
 * workspace removed) while keeping the rest in order. `isLive` receives the
 * `workspaceId:sessionId` key.
 */
export function reconcileOpenThreadTabs(
  tabs: readonly WorkspaceSessionTarget[],
  isLive: (key: string) => boolean,
): readonly WorkspaceSessionTarget[] {
  const seen = new Set<string>();
  const live: WorkspaceSessionTarget[] = [];
  for (const tab of tabs) {
    const key = threadTabKey(tab);
    if (seen.has(key) || !isLive(key)) continue;
    seen.add(key);
    live.push({ workspaceId: tab.workspaceId, sessionId: tab.sessionId });
  }
  return live;
}

/** The tab a chord or shortcut index selects, one-based like ⌘1. */
export function threadTabAt(
  tabs: readonly WorkspaceSessionTarget[],
  slot: number,
): WorkspaceSessionTarget | undefined {
  return slot >= 1 ? tabs[slot - 1] : undefined;
}
