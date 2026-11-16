import type { Dispatch, SetStateAction } from "react";
import type { DesktopAppState, WorkspaceSessionTarget } from "../../../../contracts/desktop-state";
import type { PiDesktopApi } from "../../../../contracts/ipc";
import { updateSnapshot } from "../../../app/desktop-app-state";
import type { ThreadAction } from "../thread-actions";
import type { ThreadMenuState } from "./use-thread-actions";

interface UseThreadTabActionsParams {
  readonly api: PiDesktopApi | undefined;
  readonly snapshot: DesktopAppState | null;
  readonly setSnapshot: Dispatch<SetStateAction<DesktopAppState | null>>;
  readonly threadMenu: ThreadMenuState;
}

export interface ThreadTabActions {
  /** The tab's right-click menu entries: the same shared list the sidebar row and header offer. */
  readonly actionsForTarget: (
    target: WorkspaceSessionTarget,
  ) => readonly ThreadAction[] | undefined;
  readonly renameTab: (target: WorkspaceSessionTarget, title: string) => void;
}

/**
 * A tab carries only its target, so its menu looks the session up before handing it to the shared
 * action list; renaming stays inside the strip instead of opening the sidebar's field.
 */
export function useThreadTabActions({
  api,
  snapshot,
  setSnapshot,
  threadMenu,
}: UseThreadTabActionsParams): ThreadTabActions {
  const actionsForTarget = (target: WorkspaceSessionTarget) => {
    const workspace = snapshot?.workspaces.find((entry) => entry.id === target.workspaceId);
    const session = workspace?.sessions.find((entry) => entry.id === target.sessionId);
    return session
      ? threadMenu.actionsFor({ workspaceId: target.workspaceId, session })
      : undefined;
  };

  const renameTab = (target: WorkspaceSessionTarget, title: string) => {
    if (!api) return;
    void updateSnapshot(setSnapshot, () => api.renameSession(target, title)).catch(
      (error: unknown) => {
        console.error("[renderer] renameSession failed", error);
      },
    );
  };

  return { actionsForTarget, renameTab };
}
