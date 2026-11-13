import type { ReactNode } from "react";
import { formatShortcut } from "../../../contracts/ipc";
import type { BuiltinToolKind } from "../../../contracts/workbench";
import type { Translate } from "../../i18n";
import type { ThreadAction } from "../threads/thread-actions";
import {
  BUILTIN_TOOL_ENTRIES,
  BUILTIN_TOOLS,
  TERMINAL_TOOL_KIND,
} from "../workbench/builtin-tools";
import type { SettingsSection } from "../settings/settings-view";
import { sectionTitle } from "../settings/settings-sections";
import {
  ClockIcon,
  ExtensionIcon,
  FileIcon,
  FolderIcon,
  ModelIcon,
  PlusIcon,
  SearchIcon,
  SettingsIcon,
  SidebarToggleIcon,
  SidePanelIcon,
  SkillIcon,
  TerminalIcon,
} from "../../ui/icons";

export type PaletteMode = "commands" | "files" | "models";

export interface PaletteAction {
  readonly id: string;
  readonly title: string;
  readonly icon: ReactNode;
  readonly hint?: string;
  /** Actions that open another palette list keep the palette open. */
  readonly keepsOpen?: boolean;
  readonly run: () => void;
}

/** "Settings" itself opens General. */
const SETTINGS_SECTIONS: readonly SettingsSection[] = [
  "appearance",
  "notifications",
  "shortcuts",
  "providers",
  "models",
  "mcp",
];

/** What the app can do right now; an action is listed only when it would work. */
export interface PaletteActionContext {
  readonly platform: NodeJS.Platform;
  readonly hasWorkspace: boolean;
  /** A thread is open in the main pane, with the actions its menus show. */
  readonly thread?: {
    readonly canSwitchModel: boolean;
    readonly actions: readonly ThreadAction[];
  };
  readonly canToggleSidebar: boolean;
  readonly newThread: () => void;
  readonly openFolder: () => void;
  readonly openSettings: (section: SettingsSection) => void;
  readonly openSkills: () => void;
  readonly openExtensions: () => void;
  readonly openScheduledTasks: () => void;
  readonly toggleSidebar: () => void;
  /** Shows the tool in the side panel, or hides the panel when that tool is already showing. */
  readonly toggleTool: (kind: BuiltinToolKind) => void;
  readonly toggleSidePanel: () => void;
  /** Shows or hides the docked terminal; its shells keep running while hidden. */
  readonly toggleTerminal: () => void;
  /** Extension views the side panel can open for this thread. */
  readonly extensionViews: readonly {
    readonly id: string;
    readonly title: string;
    readonly open: () => void;
  }[];
  readonly findInThread: () => void;
  readonly openPaletteMode: (mode: PaletteMode) => void;
  /** Translates the tool names this list shares with the side panel. */
  readonly t: Translate;
}

export function buildPaletteActions(context: PaletteActionContext): readonly PaletteAction[] {
  const { platform, thread } = context;
  const actions: PaletteAction[] = [];
  if (context.hasWorkspace) {
    actions.push({
      id: "new-thread",
      title: "New thread",
      icon: <PlusIcon />,
      hint: formatShortcut(platform, "N"),
      run: context.newThread,
    });
  }
  actions.push({
    id: "open-folder",
    title: "Open folder…",
    icon: <FolderIcon />,
    run: context.openFolder,
  });
  if (thread) {
    actions.push(
      {
        id: "go-to-file",
        title: "Go to file…",
        icon: <FileIcon />,
        hint: formatShortcut(platform, "P"),
        keepsOpen: true,
        run: () => context.openPaletteMode("files"),
      },
      {
        id: "find-in-thread",
        title: "Find in thread",
        icon: <SearchIcon />,
        hint: formatShortcut(platform, "F"),
        run: context.findInThread,
      },
    );
    if (thread.canSwitchModel) {
      actions.push({
        id: "switch-model",
        title: "Switch model…",
        icon: <ModelIcon />,
        keepsOpen: true,
        run: () => context.openPaletteMode("models"),
      });
    }
    for (const { kind, labelKey, Icon, shortcut } of BUILTIN_TOOL_ENTRIES) {
      actions.push({
        id: `toggle-${kind}`,
        title: context.t("workbench.toggleTool", { name: context.t(labelKey) }),
        icon: <Icon />,
        hint: shortcut
          ? formatShortcut(platform, shortcut.key, { shift: shortcut.shift })
          : undefined,
        run: () => context.toggleTool(kind),
      });
    }
    // The terminal is docked under the window, not a side panel tool, so it is
    // listed on its own instead of through BUILTIN_TOOL_ENTRIES.
    actions.push({
      id: `toggle-${TERMINAL_TOOL_KIND}`,
      title: context.t("workbench.toggleTool", {
        name: context.t(BUILTIN_TOOLS[TERMINAL_TOOL_KIND].labelKey),
      }),
      icon: <TerminalIcon />,
      hint: formatShortcut(platform, BUILTIN_TOOLS[TERMINAL_TOOL_KIND].shortcut.key),
      run: context.toggleTerminal,
    });
    actions.push({
      id: "toggle-side-panel",
      title: "Toggle side panel",
      icon: <SidePanelIcon />,
      hint: formatShortcut(platform, "B", { alt: true }),
      run: context.toggleSidePanel,
    });
    for (const view of context.extensionViews) {
      actions.push({
        id: `extension-view:${view.id}`,
        title: `Open ${view.title}`,
        icon: <ExtensionIcon />,
        run: view.open,
      });
    }
    actions.push(...thread.actions);
  }
  if (context.canToggleSidebar) {
    actions.push({
      id: "toggle-sidebar",
      title: "Toggle sidebar",
      icon: <SidebarToggleIcon />,
      hint: formatShortcut(platform, "B"),
      run: context.toggleSidebar,
    });
  }
  actions.push({
    id: "scheduled-tasks",
    title: "Scheduled tasks",
    icon: <ClockIcon />,
    run: context.openScheduledTasks,
  });
  if (context.hasWorkspace) {
    actions.push(
      { id: "skills", title: "Skills", icon: <SkillIcon />, run: context.openSkills },
      {
        id: "extensions",
        title: "Extensions",
        icon: <ExtensionIcon />,
        run: context.openExtensions,
      },
    );
  }
  actions.push({
    id: "settings",
    title: "Settings",
    icon: <SettingsIcon />,
    hint: formatShortcut(platform, ","),
    run: () => context.openSettings("general"),
  });
  for (const section of SETTINGS_SECTIONS) {
    actions.push({
      id: `settings-${section}`,
      title: `Settings: ${sectionTitle(section)}`,
      icon: <SettingsIcon />,
      run: () => context.openSettings(section),
    });
  }
  return actions;
}
