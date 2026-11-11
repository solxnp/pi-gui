import type {
  RuntimeExtensionRecord,
  RuntimeSourceScope,
} from "@pi-gui/session-driver/runtime-types";
import type { MessageKey, Translate } from "../../i18n";

/** Where an extension came from; the id, not the copy, so groups match across languages. */
export type ExtensionGroupId = "workspace" | "user" | "session" | "piAddons" | "piGuiTools";

/** List order: the workspace's own first, then pi-gui's and pi's built-ins. */
export const EXTENSION_GROUP_ORDER: readonly ExtensionGroupId[] = [
  "workspace",
  "user",
  "session",
  "piAddons",
  "piGuiTools",
];

const GROUP_LABEL_KEYS: Readonly<Record<ExtensionGroupId, MessageKey>> = {
  workspace: "extensions.group.workspace",
  user: "extensions.group.user",
  session: "extensions.group.session",
  piAddons: "extensions.group.piAddons",
  piGuiTools: "extensions.group.piGuiTools",
};

/** Extensions pi-gui itself adds to every session; switched on and off app-wide. */
export function isPiGuiBuiltinExtension(extension: RuntimeExtensionRecord): boolean {
  return (
    extension.sourceInfo.source === "builtin" &&
    extension.sourceInfo.origin === "top-level" &&
    extension.sourceInfo.scope === "temporary"
  );
}

/**
 * pi's own add-ons (MCP, code mode, tool search), named `builtin:<name>`. Their switch writes
 * pi's `extensions` setting, so terminal pi follows it too.
 */
export function isPiAddonExtension(extension: RuntimeExtensionRecord): boolean {
  return extension.sourceInfo.source === "builtin" && extension.path.startsWith("builtin:");
}

export function extensionGroupId(extension: RuntimeExtensionRecord): ExtensionGroupId {
  // Both kinds are `builtin` sources; only the path tells pi's add-ons from pi-gui's own.
  if (isPiAddonExtension(extension)) return "piAddons";
  if (isPiGuiBuiltinExtension(extension)) return "piGuiTools";
  switch (extension.sourceInfo.scope) {
    case "project":
      return "workspace";
    case "user":
      return "user";
    case "temporary":
      return "session";
  }
}

export function extensionGroupLabel(group: ExtensionGroupId, t: Translate): string {
  return t(GROUP_LABEL_KEYS[group]);
}

/**
 * One-line source for the @ menu: `User · top-level`. English on purpose, like the rest of the
 * composer's mention list, which this file does not localise yet.
 */
export function extensionSourceSummary(extension: RuntimeExtensionRecord): string {
  const scope = isPiGuiBuiltinExtension(extension)
    ? "pi-gui tools"
    : isPiAddonExtension(extension)
      ? "Built into pi"
      : sourceScopeGroupLabel(extension.sourceInfo.scope);
  return `${scope} · ${extension.sourceInfo.origin}`;
}

/** Group heading for where a skill or extension was discovered. */
export function sourceScopeGroupLabel(scope: RuntimeSourceScope): string {
  switch (scope) {
    case "project":
      return "Workspace";
    case "user":
      return "User";
    case "temporary":
      return "This session";
  }
}
