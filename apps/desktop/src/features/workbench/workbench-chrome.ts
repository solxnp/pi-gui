/*
 * The side panel's chrome — which built-in tools are open, which one is shown and
 * whether the panel is visible — belongs to the window, not to a conversation.
 * Only the panel contents (open file tabs, review scope and selected file) stay
 * per conversation, so switching projects keeps the tool the user was reading
 * and simply points it at the other project's data.
 */
import { BUILTIN_TOOL_KINDS, type BuiltinToolKind } from "../../../contracts/workbench";
import type { TaskWorkbenchTemplate, ToolRef } from "../../../contracts/workbench";

const STORAGE_KEY = "pi-gui.workbench-chrome";

export interface WorkbenchChrome {
  readonly visibility: "visible" | "hidden";
  readonly tools: readonly BuiltinToolKind[];
  /** The shown tool, or "chooser" when the strip has nothing selected. */
  readonly activeTool: BuiltinToolKind | "chooser";
}

export const DEFAULT_CHROME: WorkbenchChrome = {
  visibility: "visible",
  tools: ["tasks", "files", "changes"],
  activeTool: "tasks",
};

function isBuiltinToolKind(value: unknown): value is BuiltinToolKind {
  return (BUILTIN_TOOL_KINDS as readonly unknown[]).includes(value);
}

export function readWorkbenchChrome(): WorkbenchChrome {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_CHROME;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return DEFAULT_CHROME;
    const record = parsed as Record<string, unknown>;
    const tools = Array.isArray(record.tools)
      ? [...new Set(record.tools.filter(isBuiltinToolKind))]
      : DEFAULT_CHROME.tools;
    const activeTool =
      record.activeTool === "chooser"
        ? "chooser"
        : isBuiltinToolKind(record.activeTool)
          ? record.activeTool
          : DEFAULT_CHROME.activeTool;
    return {
      visibility: record.visibility === "hidden" ? "hidden" : "visible",
      tools: tools.length > 0 ? tools : DEFAULT_CHROME.tools,
      activeTool,
    };
  } catch {
    return DEFAULT_CHROME;
  }
}

export function writeWorkbenchChrome(chrome: WorkbenchChrome): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(chrome));
  } catch {
    // The choice still applies for this window when preferences cannot be saved.
  }
}

/** The chrome a saved view shows, once the window's own tool set is applied. */
export function chromeOf(view: TaskWorkbenchTemplate): WorkbenchChrome {
  const active = activeBuiltinTool(view);
  return {
    visibility: view.visibility,
    tools: view.tools.flatMap((tool) => (tool.kind === "extension" ? [] : [tool.kind])),
    activeTool: active,
  };
}

function activeBuiltinTool(view: TaskWorkbenchTemplate): BuiltinToolKind | "chooser" {
  const selection = view.selection;
  if (selection.kind !== "tool") return "chooser";
  const tool = view.tools.find((candidate) => toolRefKey(candidate) === selection.toolId);
  return tool && tool.kind !== "extension" ? tool.kind : "chooser";
}

function toolRefKey(tool: ToolRef): string {
  return tool.kind === "extension" ? `${tool.extensionId}:${tool.viewId}` : tool.kind;
}

/**
 * Applies the window's chrome to a per-conversation view: the same tools stay
 * open, while `files` and `changes` keep the conversation's own contents.
 * Extension views are per conversation and are left out when unavailable.
 */
export function withWorkbenchChrome(
  view: TaskWorkbenchTemplate,
  chrome: WorkbenchChrome,
): TaskWorkbenchTemplate {
  const tools: ToolRef[] = chrome.tools.map(
    (kind) => view.tools.find((tool) => tool.kind === kind) ?? { kind },
  );
  const selection: TaskWorkbenchTemplate["selection"] =
    chrome.activeTool === "chooser" || !chrome.tools.includes(chrome.activeTool)
      ? { kind: "chooser" }
      : { kind: "tool", toolId: chrome.activeTool };
  return { ...view, visibility: chrome.visibility, tools, selection };
}
