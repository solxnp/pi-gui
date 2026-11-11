/*
 * Names and descriptions for the extensions pi-gui ships.
 *
 * Main writes every extension's display name and one-line description in English because that
 * data also feeds logs and the extension list of pi itself. Settings shows them to a Chinese user
 * too, so the ones we own get a translated name, a short line for the list and a longer sentence
 * for the detail page. Everything else keeps whatever its own author wrote.
 */

import type { RuntimeExtensionRecord } from "@pi-gui/session-driver/runtime-types";
import type { MessageKey, Translate } from "../../i18n";

interface BuiltinCopyKeys {
  readonly title: MessageKey;
  readonly description: MessageKey;
  readonly detail: MessageKey;
}

/** Keyed by the path pi reports for an inline built-in or a `builtin:<name>` add-on. */
const BUILTIN_COPY: Readonly<Record<string, BuiltinCopyKeys>> = {
  "<inline:pi-gui-permission-gate>": {
    title: "extensions.builtin.permissionGate.title",
    description: "extensions.builtin.permissionGate.description",
    detail: "extensions.builtin.permissionGate.detail",
  },
  "<inline:pi-gui-scheduled-tasks>": {
    title: "extensions.builtin.scheduledTasks.title",
    description: "extensions.builtin.scheduledTasks.description",
    detail: "extensions.builtin.scheduledTasks.detail",
  },
  "<inline:pi-gui-thread-orchestration>": {
    title: "extensions.builtin.threadOrchestration.title",
    description: "extensions.builtin.threadOrchestration.description",
    detail: "extensions.builtin.threadOrchestration.detail",
  },
  "<inline:pi-gui-custom-instructions>": {
    title: "extensions.builtin.customInstructions.title",
    description: "extensions.builtin.customInstructions.description",
    detail: "extensions.builtin.customInstructions.detail",
  },
  "builtin:mcp": {
    title: "extensions.builtin.mcp.title",
    description: "extensions.builtin.mcp.description",
    detail: "extensions.builtin.mcp.detail",
  },
  "builtin:codemode": {
    title: "extensions.builtin.codemode.title",
    description: "extensions.builtin.codemode.description",
    detail: "extensions.builtin.codemode.detail",
  },
  "builtin:tool-search": {
    title: "extensions.builtin.toolSearch.title",
    description: "extensions.builtin.toolSearch.description",
    detail: "extensions.builtin.toolSearch.detail",
  },
};

export interface ExtensionCopy {
  readonly title: string;
  /** One line for the list row. */
  readonly description: string;
  /** The longer explanation the detail page shows, when one is written. */
  readonly detail?: string;
}

/** The translated name and description, or the extension's own when it is not one of ours. */
export function extensionCopy(extension: RuntimeExtensionRecord, t: Translate): ExtensionCopy {
  const keys = BUILTIN_COPY[extension.path];
  if (keys) {
    return {
      title: t(keys.title),
      description: t(keys.description),
      detail: t(keys.detail),
    };
  }
  return {
    title: extension.displayName,
    description: describeExtension(extension, t),
  };
}

/** One line for the list: the extension's own description, else what it contributes. */
export function describeExtension(extension: RuntimeExtensionRecord, t: Translate): string {
  if (extension.description) return extension.description;
  const parts = [
    countLabel(extension.tools.length, "extensions.count.tool", t),
    countLabel(extension.commands.length, "extensions.count.command", t),
    countLabel(extension.diagnostics.length, "extensions.count.issue", t),
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(" · ") : extension.sourceInfo.source;
}

function countLabel(count: number, key: MessageKey, t: Translate): string {
  return count === 0 ? "" : t(key, { count });
}

/** Everything the search box should match, including the translated copy. */
export function extensionSearchCopy(extension: RuntimeExtensionRecord, t: Translate): string {
  const copy = extensionCopy(extension, t);
  return [copy.title, copy.description, copy.detail ?? ""].join(" ");
}
