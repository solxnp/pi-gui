import { useCallback, useEffect, useMemo, useRef, type Dispatch, type SetStateAction } from "react";
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
import type { ThreadSidebarModel } from "./thread-groups";
import type { ThreadTabEntry } from "./thread-tabs";

const EMPTY_TABS: readonly WorkspaceSessionTarget[] = [];

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
      const next = openThreadTab(openThreadTabs, target);
      if (next !== openThreadTabs) writeTabs(next);
      selectThread(target);
    },
    [openThreadTabs, selectThread, writeTabs],
  );

  const closeTab = useCallback(
    (target: WorkspaceSessionTarget) => {
      closedKeyRef.current = threadTabKey(target);
      writeTabs(closeThreadTab(openThreadTabs, target));
      if (threadTabKey(target) !== sessionKey) return;
      const neighbor = threadTabNeighbor(openThreadTabs, target);
      if (neighbor) selectThread(neighbor);
      else setActiveView("new-thread");
    },
    [openThreadTabs, selectThread, sessionKey, setActiveView, writeTabs],
  );

  const closeTabIfOpen = useCallback(
    (target: WorkspaceSessionTarget) => {
      const key = threadTabKey(target);
      if (!openThreadTabs.some((tab) => threadTabKey(tab) === key)) return false;
      closeTab(target);
      return true;
    },
    [closeTab, openThreadTabs],
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
    const entries = new Map(
      threadSidebarModel.recencyOrder.map((entry) => [
        `${entry.workspaceId}:${entry.session.id}`,
        entry,
      ]),
    );
    const projectName = (workspaceId: string) =>
      threadSidebarModel.folders.find((workspace) => workspace.id === workspaceId)?.name ?? "";
    return openThreadTabs.flatMap((target) => {
      const key = threadTabKey(target);
      const entry = entries.get(key);
      if (!entry) return [];
      const pending = snapshot?.sessionExtensionUiBySession?.[key];
      const { status, hasUnseenUpdate } = entry.session;
      return [
        {
          target,
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
          awaitingInput: (pending?.pendingDialogs.length ?? 0) > 0,
        } satisfies ThreadTabEntry,
      ];
    });
  }, [openThreadTabs, snapshot?.sessionExtensionUiBySession, threadSidebarModel]);

  return { tabs, openTab, closeTab, closeTabIfOpen };
}
