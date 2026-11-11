import type { RuntimeExtensionRecord } from "@pi-gui/session-driver/runtime-types";
import type {
  ExtensionCommandCompatibilityRecord,
  WorkspaceRecord,
} from "../../../contracts/desktop-state";
import { useTranslation, type Translate } from "../../i18n";
import { ExtensionIcon } from "../../ui/icons";
import { SettingsGroup, SettingsRow } from "../settings/settings-utils";
import { extensionCopy } from "./extension-copy";
import {
  EXTENSION_GROUP_ORDER,
  extensionGroupId,
  extensionGroupLabel,
  isPiAddonExtension,
  isPiGuiBuiltinExtension,
} from "./extension-display";
import { displayPath, ResourceDetail } from "./resource-detail";
import { ResourceEmptyState, ResourceList, type ResourceListGroup } from "./resource-list";

interface ExtensionsTabProps {
  readonly workspace: WorkspaceRecord;
  readonly extensions: readonly RuntimeExtensionRecord[];
  readonly commandCompatibility: readonly ExtensionCommandCompatibilityRecord[];
  readonly searching: boolean;
  /** The extension whose detail page is open, looked up in the unfiltered list. */
  readonly selected?: RuntimeExtensionRecord;
  readonly onSelect: (path: string | undefined) => void;
  readonly onToggleExtension: (path: string, enabled: boolean) => void;
  readonly onOpenExtensionFolder: (path: string) => void;
}

export function ExtensionsTab({
  workspace,
  extensions,
  commandCompatibility,
  searching,
  selected,
  onSelect,
  onToggleExtension,
  onOpenExtensionFolder,
}: ExtensionsTabProps) {
  const { t } = useTranslation();
  // The list stays mounted under an open detail so expanded groups, scroll and focus survive.
  const list =
    extensions.length === 0 ? (
      <ResourceEmptyState
        title={searching ? "No extensions match" : "No extensions yet"}
        body={
          searching
            ? "Try another name, command or tool."
            : "Extensions are discovered in this workspace and your user extension folders. Refresh after adding one."
        }
      />
    ) : (
      <ResourceList
        expanded={searching}
        groups={groupExtensions(extensions, onToggleExtension, t)}
        icon={<ExtensionIcon />}
        testId="extensions-list"
        onOpen={onSelect}
      />
    );

  return (
    <>
      {selected ? (
        <ExtensionDetail
          commandCompatibility={commandCompatibility}
          selected={selected}
          workspace={workspace}
          onOpenExtensionFolder={onOpenExtensionFolder}
          onSelect={onSelect}
          onToggleExtension={onToggleExtension}
        />
      ) : null}
      <div hidden={Boolean(selected)}>{list}</div>
    </>
  );
}

function ExtensionDetail({
  selected,
  workspace,
  commandCompatibility,
  onSelect,
  onToggleExtension,
  onOpenExtensionFolder,
}: Omit<ExtensionsTabProps, "extensions" | "searching" | "selected"> & {
  readonly selected: RuntimeExtensionRecord;
}) {
  const { t } = useTranslation();
  const copy = extensionCopy(selected, t);
  const hasFolder = isFolderExtension(selected);
  const compatibilityRecords = commandCompatibility
    .filter((record) => record.extensionPath === selected.path)
    .sort((left, right) => left.commandName.localeCompare(right.commandName));
  return (
    <ResourceDetail
      actions={
        hasFolder ? (
          <button
            className="button button--secondary"
            type="button"
            onClick={() => onOpenExtensionFolder(selected.path)}
          >
            {t("extensions.detail.openFolder")}
          </button>
        ) : null
      }
      backLabel={t("extensions.detail.back")}
      enabled={selected.enabled}
      icon={<ExtensionIcon />}
      subtitle={extensionGroupLabel(extensionGroupId(selected), t)}
      title={copy.title}
      switchLabel={t("extensions.detail.enabled")}
      onBack={() => onSelect(undefined)}
      onToggle={
        isToggleableExtension(selected)
          ? (enabled) => onToggleExtension(selected.path, enabled)
          : undefined
      }
    >
      <p className="resource-detail__description">{copy.detail ?? copy.description}</p>
      <SettingsGroup>
        <SettingsRow
          title={t("extensions.detail.source")}
          description={
            isPiAddonExtension(selected)
              ? t("extensions.detail.sourcePiAddon")
              : selected.sourceInfo.origin === "package"
                ? t("extensions.detail.sourcePackage")
                : t("extensions.detail.sourceFile")
          }
        >
          <span className="settings-row__value">
            {extensionGroupLabel(extensionGroupId(selected), t)}
          </span>
        </SettingsRow>
        {isPiGuiBuiltinExtension(selected) || isPiAddonExtension(selected) ? null : (
          <SettingsRow title={t("extensions.detail.location")}>
            <code className="resource-detail__code" title={selected.path}>
              {displayPath(selected.path, workspace.path)}
            </code>
          </SettingsRow>
        )}
      </SettingsGroup>
      <ExtensionContributionSection
        title={t("extensions.detail.tools")}
        items={selected.tools.map((tool) => tool.name)}
      />
      {selected.commands.length > 0 ? (
        <ExtensionCompatibilitySection
          commands={selected.commands}
          compatibilityRecords={compatibilityRecords}
        />
      ) : null}
      <ExtensionContributionSection title={t("extensions.detail.flags")} items={selected.flags} />
      <ExtensionContributionSection
        title={t("extensions.detail.shortcuts")}
        items={selected.shortcuts}
      />
      <ExtensionDiagnostics diagnostics={selected.diagnostics} />
    </ResourceDetail>
  );
}

function groupExtensions(
  extensions: readonly RuntimeExtensionRecord[],
  onToggleExtension: (path: string, enabled: boolean) => void,
  t: Translate,
): readonly ResourceListGroup[] {
  return EXTENSION_GROUP_ORDER.map((groupId) => ({
    label: extensionGroupLabel(groupId, t),
    items: extensions
      .filter((extension) => extensionGroupId(extension) === groupId)
      .map((extension) => {
        const copy = extensionCopy(extension, t);
        return {
          id: extension.path,
          title: copy.title,
          description: copy.description,
          toggleLabel: t("extensions.toggle", { name: copy.title }),
          enabled: extension.enabled,
          onToggle: isToggleableExtension(extension)
            ? (enabled: boolean) => onToggleExtension(extension.path, enabled)
            : undefined,
        };
      }),
  })).filter((group) => group.items.length > 0);
}

function isFolderExtension(extension: RuntimeExtensionRecord): boolean {
  return (
    !isPiAddonExtension(extension) &&
    (extension.sourceInfo.scope === "project" || extension.sourceInfo.scope === "user")
  );
}

function isToggleableExtension(extension: RuntimeExtensionRecord): boolean {
  return (
    isFolderExtension(extension) ||
    isPiAddonExtension(extension) ||
    isPiGuiBuiltinExtension(extension)
  );
}

function ExtensionContributionSection({
  title,
  items,
}: {
  readonly title: string;
  readonly items: readonly string[];
}) {
  if (items.length === 0) return null;
  return (
    <SettingsGroup title={title}>
      <div className="resource-detail__tokens">
        {items.map((item) => (
          <code className="resource-detail__token" key={item}>
            {item}
          </code>
        ))}
      </div>
    </SettingsGroup>
  );
}

function ExtensionDiagnostics({
  diagnostics,
}: {
  readonly diagnostics: RuntimeExtensionRecord["diagnostics"];
}) {
  const { t } = useTranslation();
  if (diagnostics.length === 0) return null;
  return (
    <SettingsGroup title={t("extensions.detail.diagnostics")}>
      {diagnostics.map((diagnostic, index) => (
        <div
          className={`activity-item activity-item--${diagnostic.type === "error" ? "error" : "info"}`}
          key={`${diagnostic.message}:${index}`}
        >
          <div className="activity-item__text">{diagnostic.message}</div>
          {diagnostic.path ? <div className="activity-item__meta">{diagnostic.path}</div> : null}
        </div>
      ))}
    </SettingsGroup>
  );
}

function ExtensionCompatibilitySection({
  commands,
  compatibilityRecords,
}: {
  readonly commands: readonly string[];
  readonly compatibilityRecords: readonly ExtensionCommandCompatibilityRecord[];
}) {
  const { t } = useTranslation();
  const supported = compatibilityRecords.filter((record) => record.status === "supported");
  const terminalOnly = compatibilityRecords.filter((record) => record.status === "terminal-only");
  const unknown = commands.filter((commandName) =>
    compatibilityRecords.every(
      (record) =>
        record.commandName !== commandName && !record.commandName.startsWith(`${commandName}:`),
    ),
  );

  return (
    <SettingsGroup
      title={t("extensions.detail.commands")}
      description={t("extensions.detail.commandsDescription")}
    >
      <div className="resource-detail__tokens">
        {supported.map((record) => (
          <code className="resource-detail__token" key={`supported:${record.commandName}`}>
            {t("extensions.detail.commandGui", { name: record.commandName })}
          </code>
        ))}
        {terminalOnly.map((record) => (
          <code
            className="resource-detail__token resource-detail__token--warning"
            key={`terminal:${record.commandName}`}
          >
            {t("extensions.detail.commandTerminalOnly", { name: record.commandName })}
          </code>
        ))}
        {unknown.map((commandName) => (
          <code className="resource-detail__token" key={`unknown:${commandName}`}>
            {t("extensions.detail.commandUnknown", { name: commandName })}
          </code>
        ))}
      </div>
    </SettingsGroup>
  );
}
