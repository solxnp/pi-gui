import type { AppView, WorkspaceRecord } from "../../contracts/desktop-state";

interface TopbarNavigationInput {
  readonly selectedWorkspace: WorkspaceRecord | undefined;
  readonly threadOverviewOpen: boolean;
  readonly setThreadOverviewOpen: (update: (open: boolean) => boolean) => void;
  readonly closeThreadOverview: () => void;
  readonly openNewThreadSurface: (workspaceId?: string) => void;
  readonly setActiveView: (view: AppView) => void;
  readonly openSkills: () => void;
  readonly openExtensions: () => void;
  readonly openSettings: () => void;
}

/**
 * The topbar's navigation actions. Every one of them leaves the current view, so
 * they share the same first step: the 「全部会话」overlay closes behind them.
 */
export function useTopbarNavigation({
  selectedWorkspace,
  threadOverviewOpen,
  setThreadOverviewOpen,
  closeThreadOverview,
  openNewThreadSurface,
  setActiveView,
  openSkills,
  openExtensions,
  openSettings,
}: TopbarNavigationInput) {
  return {
    threadsOpen: threadOverviewOpen,
    onNewThread: () => {
      closeThreadOverview();
      openNewThreadSurface(selectedWorkspace?.rootWorkspaceId ?? selectedWorkspace?.id);
    },
    onOpenThreads: () => setThreadOverviewOpen((current) => !current),
    onOpenScheduled: () => {
      closeThreadOverview();
      setActiveView("scheduled");
    },
    onOpenSkills: () => {
      closeThreadOverview();
      openSkills();
    },
    onOpenExtensions: () => {
      closeThreadOverview();
      openExtensions();
    },
    onOpenSettings: () => {
      closeThreadOverview();
      openSettings();
    },
  };
}
