import type { MouseEvent as ReactMouseEvent, ReactNode } from "react";
import type { AppView, WorkspaceRecord, WorktreeRecord } from "../../contracts/desktop-state";
import {
  formatShortcut,
  getSidePanelToggleShortcutLabel,
  type PiDesktopApi,
} from "../../contracts/ipc";
import {
  ClockIcon,
  ExtensionIcon,
  FolderIcon,
  SettingsIcon,
  SidePanelIcon,
  SkillIcon,
  TerminalIcon,
} from "../ui/icons";
import { useTranslation } from "../i18n";

interface TopbarProps {
  readonly activeView: AppView;
  readonly sessionTitle?: string;
  readonly children?: ReactNode;
  readonly rootWorkspace: WorkspaceRecord | undefined;
  readonly selectedWorkspace: WorkspaceRecord | undefined;
  readonly selectedWorktree: WorktreeRecord | undefined;
  readonly api: PiDesktopApi;
  readonly panelAvailable: boolean;
  readonly panelVisible: boolean;
  /** Rendered in the actions cluster, next to the side-panel toggle. */
  readonly editorControl?: ReactNode;
  readonly onTogglePanel: () => void;
  /** Whether a thread is open, so the terminal dock has a shell to show. */
  readonly terminalAvailable: boolean;
  readonly terminalOpen: boolean;
  /** Shows or hides the docked terminal; the shells keep running while hidden. */
  readonly onToggleTerminal: () => void;
  /** Whether the 「全部会话」overlay is showing, for the pressed state. */
  readonly threadsOpen: boolean;
  readonly onNewThread: () => void;
  readonly onOpenThreads: () => void;
  readonly onOpenScheduled: () => void;
  readonly onOpenSkills: () => void;
  readonly onOpenExtensions: () => void;
  readonly onOpenSettings: () => void;
}

/**
 * The app's only navigation row: new thread, the conversation overview, and the
 * four secondary views that used to sit in the left column. Labels hide first
 * when the window narrows; the icons stay.
 */
export function Topbar({
  activeView,
  sessionTitle,
  children,
  rootWorkspace,
  selectedWorkspace,
  selectedWorktree,
  api,
  panelAvailable,
  panelVisible,
  editorControl,
  onTogglePanel,
  terminalAvailable,
  terminalOpen,
  onToggleTerminal,
  threadsOpen,
  onNewThread,
  onOpenThreads,
  onOpenScheduled,
  onOpenSkills,
  onOpenExtensions,
  onOpenSettings,
}: TopbarProps) {
  const { t } = useTranslation();
  const handleDoubleClick = (event: ReactMouseEvent<HTMLElement>) => {
    const target = event.target;
    if (!(target instanceof HTMLElement) || target.closest(".topbar__actions")) return;
    void api.toggleWindowMaximize().catch((error: unknown) => {
      console.error("[renderer] toggleWindowMaximize failed", error);
    });
  };
  const checkoutLabel =
    selectedWorkspace?.kind === "worktree"
      ? (selectedWorktree?.name ?? selectedWorkspace.branchName ?? selectedWorkspace.name)
      : selectedWorkspace?.branchName;
  const navItem = (
    label: string,
    active: boolean,
    Icon: () => ReactNode,
    onClick: () => void,
    testId: string,
  ) => (
    <button
      aria-pressed={active}
      className={`topbar__nav-item${active ? " topbar__nav-item--active" : ""}`}
      data-testid={testId}
      onClick={onClick}
      title={label}
      type="button"
    >
      <Icon />
      <span className="topbar__nav-label">{label}</span>
    </button>
  );

  return (
    <header className="topbar" data-testid="topbar" onDoubleClick={handleDoubleClick}>
      <nav aria-label={t("topbar.nav")} className="topbar__nav">
        <button
          className="topbar__new"
          data-testid="topbar-new-thread"
          disabled={!selectedWorkspace}
          onClick={onNewThread}
          title={t("sidebar.newThread")}
          type="button"
        >
          <span aria-hidden="true">+</span>
          <span className="topbar__nav-label">{t("sidebar.newThread")}</span>
        </button>
        <button
          aria-expanded={threadsOpen}
          className={`topbar__nav-item${threadsOpen ? " topbar__nav-item--active" : ""}`}
          data-testid="topbar-threads"
          onClick={onOpenThreads}
          title={t("topbar.allThreads")}
          type="button"
        >
          <FolderIcon />
          <span className="topbar__nav-label">{t("topbar.allThreads")}</span>
        </button>
        {navItem(
          t("sidebar.navScheduled"),
          activeView === "scheduled",
          ClockIcon,
          onOpenScheduled,
          "sidebar-scheduled",
        )}
        {navItem(t("sidebar.navSkills"), false, SkillIcon, onOpenSkills, "topbar-skills")}
        {navItem(
          t("sidebar.navExtensions"),
          false,
          ExtensionIcon,
          onOpenExtensions,
          "topbar-extensions",
        )}
        {navItem(t("sidebar.navSettings"), false, SettingsIcon, onOpenSettings, "topbar-settings")}
      </nav>
      <div className="topbar__title">
        <span
          className="topbar__workspace"
          title={checkoutLabel ? `${rootWorkspace?.name ?? ""} · ${checkoutLabel}` : undefined}
        >
          {rootWorkspace ? rootWorkspace.name : t("topbar.openFolderToBegin")}
        </span>
        {sessionTitle ? (
          <>
            <span className="topbar__separator">/</span>
            <h1 className="chat-header__title" title={sessionTitle}>
              {sessionTitle}
            </h1>
          </>
        ) : activeView === "threads" && checkoutLabel ? (
          <>
            <span className="topbar__separator">/</span>
            <span className="topbar__session">{checkoutLabel}</span>
          </>
        ) : activeView === "new-thread" && rootWorkspace ? (
          <>
            <span className="topbar__separator">/</span>
            <span className="topbar__session">{t("topbar.newThread")}</span>
          </>
        ) : null}
      </div>
      <div className="topbar__actions">
        {children}
        {editorControl}
        <div className="shortcut-tooltip-wrap topbar__tooltip-wrap">
          <button
            type="button"
            aria-label={t("topbar.toggleTerminal")}
            aria-pressed={terminalOpen}
            data-testid="toggle-terminal"
            className={`icon-button topbar__icon${terminalOpen ? " icon-button--active" : ""}`}
            disabled={!terminalAvailable}
            onClick={onToggleTerminal}
          >
            <TerminalIcon />
          </button>
          <span className="shortcut-tooltip topbar__tooltip" role="tooltip">
            <span>{terminalOpen ? t("topbar.hideTerminal") : t("topbar.showTerminal")}</span>
            <kbd>{formatShortcut(api.platform, "J")}</kbd>
          </span>
        </div>
        {!panelVisible ? (
          <div className="shortcut-tooltip-wrap topbar__tooltip-wrap">
            <button
              type="button"
              aria-label={t("topbar.toggleSidePanel")}
              aria-pressed={panelVisible}
              aria-controls="task-workbench"
              data-testid="toggle-side-panel"
              className={`icon-button topbar__icon${panelVisible ? " icon-button--active" : ""}`}
              disabled={!panelAvailable}
              onClick={onTogglePanel}
            >
              <SidePanelIcon />
            </button>
            <span className="shortcut-tooltip topbar__tooltip" role="tooltip">
              <span>{panelVisible ? t("topbar.hideSidePanel") : t("topbar.showSidePanel")}</span>
              <kbd>{getSidePanelToggleShortcutLabel(api.platform)}</kbd>
            </span>
          </div>
        ) : null}
      </div>
    </header>
  );
}
