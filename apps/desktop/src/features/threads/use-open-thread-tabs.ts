import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import type {
  AppView,
  DesktopAppState,
  WorkspaceSessionTarget,
} from "../../../contracts/desktop-state";
import type { PiDesktopApi } from "../../../contracts/ipc";
import {
  closeThreadTab,
  openThreadTab,
  threadTabKey,
  threadTabNeighbor,
} from "../../../contracts/open-thread-tabs";
import { updateSnapshot } from "../../app/desktop-app-state";
import { pendingApprovalSessionKeys } from "./pending-approval";
import type { ThreadSidebarModel } from "./thread-groups";
import type { ThreadTabEntry } from "./thread-tabs";

const EMPTY_TABS: readonly WorkspaceSessionTarget[] = [];

/** Conversations the user closed from the strip; they stay reachable in 「全部会话」. */
const HIDDEN_TABS_STORAGE_KEY = "pi-gui.hidden-thread-tabs";

function readHiddenTabs(): readonly string[] {
  try {
    const raw = localStorage.getItem(HIDDEN_TABS_STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed)
      ? parsed.filter((key): key is string => typeof key === "string")
      : [];
  } catch {
    return [];
  }
}

function writeHiddenTabs(keys: readonly string[]): void {
  try {
    localStorage.setItem(HIDDEN_TABS_STORAGE_KEY, JSON.stringify(keys));
  } catch {
    // The strip stays as it is for this window when preferences cannot be saved.
  }
}

interface ThreadTabsInput {
  /** Undefined until the desktop bridge answers; the strip stays empty until then. */
  readonly api: PiDesktopApi | undefined;
  readonly snapshot: DesktopAppState | null;
  readonly setSnapshot: Dispatch<SetStateAction<DesktopAppState | null>>;
  readonly threadSidebarModel: ThreadSidebarModel | undefined;
  readonly sessionKey: string;
  /** Switches the main pane; the caller flushes drafts and scroll first. */
  readonly selectThread: (target: WorkspaceSessionTarget) => void;
  readonly setActiveView: (view: AppView) => void;
}

interface ThreadTabsApi {
  /** The strip's tabs, already resolved to titles and status dots. */
  readonly tabs: readonly ThreadTabEntry[];
  /** Opens (or re-focuses) a conversation's tab and shows it. */
  readonly openTab: (target: WorkspaceSessionTarget) => void;
  /** Closes a tab; when it was the shown one, its neighbour takes over. */
  readonly closeTab: (target: WorkspaceSessionTarget) => void;
  /** Same, but reports whether that conversation was open at all. */
  readonly closeTabIfOpen: (target: WorkspaceSessionTarget) => boolean;
}

/**
 * Keeps the window's open-tab list and the transcript selection in step:
 * selecting a conversation opens its tab, closing the shown tab moves to the
 * neighbour, and a selection restored from disk always has a tab of its own.
 */
export function useThreadTabs({
  api,
  snapshot,
  setSnapshot,
  threadSidebarModel,
  sessionKey,
  selectThread,
  setActiveView,
}: ThreadTabsInput): ThreadTabsApi {
  const openThreadTabs = snapshot?.openThreadTabs ?? EMPTY_TABS;
  // Every conversation shows as a tab; closing one only hides it until it is
  // opened again from 「全部会话」.
  const [hiddenKeys, setHiddenKeys] = useState<readonly string[]>(readHiddenTabs);
  const hiddenRef = useRef(hiddenKeys);
  hiddenRef.current = hiddenKeys;
  const unhide = useCallback((key: string) => {
    if (!hiddenRef.current.includes(key)) return;
    const next = hiddenRef.current.filter((entry) => entry !== key);
    writeHiddenTabs(next);
    setHiddenKeys(next);
  }, []);
  const hide = useCallback((key: string) => {
    if (hiddenRef.current.includes(key)) return;
    const next = [...hiddenRef.current, key];
    writeHiddenTabs(next);
    setHiddenKeys(next);
  }, []);
  // A just-closed conversation is still the selected one until the neighbour's
  // selection lands; the ensure effect below must not reopen its tab meanwhile.
  const closedKeyRef = useRef<string | null>(null);

  const writeTabs = useCallback(
    (tabs: readonly WorkspaceSessionTarget[]) => {
      if (!api) return;
      void updateSnapshot(setSnapshot, () => api.setOpenThreadTabs(tabs)).catch(
        (error: unknown) => {
          console.error("[renderer] setOpenThreadTabs failed", error);
        },
      );
    },
    [api, setSnapshot],
  );

  const openTab = useCallback(
    (target: WorkspaceSessionTarget) => {
      unhide(threadTabKey(target));
      const next = openThreadTab(openThreadTabs, target);
      if (next !== openThreadTabs) writeTabs(next);
      selectThread(target);
    },
    [openThreadTabs, selectThread, unhide, writeTabs],
  );

  const closeTab = useCallback(
    (target: WorkspaceSessionTarget) => {
      closedKeyRef.current = threadTabKey(target);
      hide(threadTabKey(target));
      writeTabs(closeThreadTab(openThreadTabs, target));
      if (threadTabKey(target) !== sessionKey) return;
      const neighbor = threadTabNeighbor(openThreadTabs, target);
      if (neighbor) selectThread(neighbor);
      else setActiveView("new-thread");
    },
    [hide, openThreadTabs, selectThread, sessionKey, setActiveView, writeTabs],
  );

  const closeTabIfOpen = useCallback(
    (target: WorkspaceSessionTarget) => {
      closeTab(target);
      return true;
    },
    [closeTab],
  );

  useEffect(() => {
    // A selection restored from an older profile has no tab yet; ⌘1-9 and the
    // strip would then disagree with what the window shows.
    if (!sessionKey) return;
    const [workspaceId, sessionId] = sessionKey.split(":");
    if (!workspaceId || !sessionId) return;
    if (snapshot?.activeView !== "threads") return;
    if (closedKeyRef.current !== null) {
      if (closedKeyRef.current === sessionKey) return;
      closedKeyRef.current = null;
    }
    if (openThreadTabs.some((tab) => threadTabKey(tab) === sessionKey)) return;
    writeTabs(openThreadTab(openThreadTabs, { workspaceId, sessionId }));
  }, [openThreadTabs, sessionKey, snapshot?.activeView, writeTabs]);

  const tabs = useMemo((): readonly ThreadTabEntry[] => {
    if (!threadSidebarModel) return [];
    const projectName = (workspaceId: string) =>
      threadSidebarModel.folders.find((workspace) => workspace.id === workspaceId)?.name ?? "";
    const hidden = new Set(hiddenKeys);
    // Same source as the list's marker, so a dialog cannot be flagged in one place
    // and missed in the other.
    const pendingKeys = pendingApprovalSessionKeys(snapshot?.sessionExtensionUiBySession);
    const toTab = (entry: (typeof threadSidebarModel.recencyOrder)[number]): ThreadTabEntry => {
      const key = `${entry.workspaceId}:${entry.session.id}`;
      const { status, hasUnseenUpdate } = entry.session;
      return {
        target: { workspaceId: entry.workspaceId, sessionId: entry.session.id },
        key,
        title: entry.session.title,
        projectName: projectName(entry.folderId),
        status:
          status === "running"
            ? "running"
            : status === "failed"
              ? "failed"
              : hasUnseenUpdate
                ? "unseen"
                : "none",
        awaitingInput: pendingKeys.has(key),
      };
    };
    // Open order stays stable so ⌘1-9 keep their slots; conversations that were
    // never opened follow in recency order, so every thread is visible without
    // having to be found in 「全部会话」 first.
    const ordered: ThreadTabEntry[] = [];
    const seen = new Set<string>();
    const byKey = new Map(
      threadSidebarModel.recencyOrder.map((entry) => [
        `${entry.workspaceId}:${entry.session.id}`,
        entry,
      ]),
    );
    for (const target of openThreadTabs) {
      const key = threadTabKey(target);
      const entry = byKey.get(key);
      if (!entry || seen.has(key) || hidden.has(key)) continue;
      seen.add(key);
      ordered.push(toTab(entry));
    }
    for (const entry of threadSidebarModel.recencyOrder) {
      const key = `${entry.workspaceId}:${entry.session.id}`;
      if (seen.has(key) || hidden.has(key)) continue;
      seen.add(key);
      ordered.push(toTab(entry));
    }
    return ordered;
  }, [hiddenKeys, openThreadTabs, snapshot?.sessionExtensionUiBySession, threadSidebarModel]);

  return { tabs, openTab, closeTab, closeTabIfOpen };
}
