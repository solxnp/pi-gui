import type { ComponentType, ReactNode } from "react";
import { BUILTIN_TOOL_KINDS, type BuiltinToolKind } from "../../../contracts/workbench";
import type { MessageKey } from "../../i18n";
import { CheckIcon, DiffIcon, FileIcon, TerminalIcon } from "../../ui/icons";

/** The platform-modifier chord that toggles a tool, formatted by `formatShortcut`. */
export interface BuiltinToolShortcut {
  readonly key: string;
  readonly shift?: boolean;
}

interface BuiltinToolDefinition {
  /** Name shown on the tab, in the chooser and in the command palette. */
  readonly labelKey: MessageKey;
  /** Shown in the tool chooser. */
  readonly descriptionKey: MessageKey;
  readonly Icon: ComponentType;
  /** Key that toggles the tool with the platform modifier, when it has one. */
  readonly shortcut?: BuiltinToolShortcut;
}

/** Presentation for every built-in tool; a missing kind fails the build. */
export const BUILTIN_TOOLS = {
  tasks: {
    labelKey: "workbench.tool.tasks",
    descriptionKey: "workbench.tool.tasks.description",
    Icon: CheckIcon,
    shortcut: { key: "T", shift: true },
  },
  files: {
    labelKey: "workbench.tool.files",
    descriptionKey: "workbench.tool.files.description",
    Icon: FileIcon,
    shortcut: { key: "O", shift: true },
  },
  changes: {
    labelKey: "workbench.tool.review",
    descriptionKey: "workbench.tool.review.description",
    Icon: DiffIcon,
    shortcut: { key: "R" },
  },
  terminal: {
    labelKey: "workbench.tool.terminal",
    descriptionKey: "workbench.tool.terminal.description",
    Icon: TerminalIcon,
    shortcut: { key: "J" },
  },
} as const satisfies Record<BuiltinToolKind, BuiltinToolDefinition>;

/** Tools the side panel can hold; the terminal lives in the bottom bar instead. */
export const SIDE_PANEL_TOOL_KINDS = BUILTIN_TOOL_KINDS.filter((kind) => kind !== "terminal");

/** Chooser order follows the contract's kind list. */
export const BUILTIN_TOOL_ENTRIES = SIDE_PANEL_TOOL_KINDS.map(
  (kind): BuiltinToolDefinition & { readonly kind: BuiltinToolKind } => ({
    kind,
    ...BUILTIN_TOOLS[kind],
  }),
);

/** The composition root supplies one panel per built-in tool; rendered only while selected. */
type BuiltinToolPanels = Record<BuiltinToolKind, () => ReactNode>;

/** Requires a panel for every built-in kind, so a new tool cannot silently render nothing. */
export function renderBuiltinToolPanel(
  kind: BuiltinToolKind,
  panels: BuiltinToolPanels,
): ReactNode {
  return panels[kind]();
}
