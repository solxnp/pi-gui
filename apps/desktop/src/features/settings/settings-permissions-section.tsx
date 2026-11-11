import { useCallback, useEffect, useState } from "react";
import type { PermissionRuleRecord } from "../../../contracts/ipc";
import {
  permissionCategoryIds,
  type PermissionCategoryId,
  type PermissionPreferences,
  type PermissionPreferencesPatch,
} from "../../../contracts/permission-preferences";
import { useTranslation, type MessageKey } from "../../i18n";
import { SettingsSwitch } from "./settings-controls";
import { SettingsGroup, SettingsRow } from "./settings-utils";

/** The rows of the "Commands" group; bash rules only. */
const COMMAND_CATEGORIES: readonly PermissionCategoryId[] = [
  "delete-disk",
  "sudo",
  "file-mode",
  "git",
  "remote-script",
  "containers",
  "system-services",
];

/** The rows of the "Files" group; one path rule set and the command-line file-name rules. */
const FILE_CATEGORIES: readonly PermissionCategoryId[] = [
  "credential-files",
  "credential-commands",
];

const CATEGORY_COPY: Readonly<
  Record<PermissionCategoryId, { readonly title: MessageKey; readonly description: MessageKey }>
> = {
  "delete-disk": {
    title: "settings.permissions.category.deleteDisk.title",
    description: "settings.permissions.category.deleteDisk.description",
  },
  sudo: {
    title: "settings.permissions.category.sudo.title",
    description: "settings.permissions.category.sudo.description",
  },
  "file-mode": {
    title: "settings.permissions.category.fileMode.title",
    description: "settings.permissions.category.fileMode.description",
  },
  git: {
    title: "settings.permissions.category.git.title",
    description: "settings.permissions.category.git.description",
  },
  "remote-script": {
    title: "settings.permissions.category.remoteScript.title",
    description: "settings.permissions.category.remoteScript.description",
  },
  containers: {
    title: "settings.permissions.category.containers.title",
    description: "settings.permissions.category.containers.description",
  },
  "system-services": {
    title: "settings.permissions.category.systemServices.title",
    description: "settings.permissions.category.systemServices.description",
  },
  "credential-files": {
    title: "settings.permissions.category.credentialFiles.title",
    description: "settings.permissions.category.credentialFiles.description",
  },
  "credential-commands": {
    title: "settings.permissions.category.credentialCommands.title",
    description: "settings.permissions.category.credentialCommands.description",
  },
};

interface SettingsPermissionsSectionProps {
  readonly preferences: PermissionPreferences;
  readonly onSetPreferences: (patch: PermissionPreferencesPatch) => void;
  readonly onSetEnabled: (enabled: boolean) => void;
  readonly listRules: () => Promise<readonly PermissionRuleRecord[]>;
}

/**
 * The permission gate's settings: one master switch, the categories that can be silenced, and a
 * collapsed list of the rules behind each category. Rules load on first expand so opening the page
 * never waits on main.
 */
export function SettingsPermissionsSection({
  preferences,
  onSetPreferences,
  onSetEnabled,
  listRules,
}: SettingsPermissionsSectionProps) {
  const { t } = useTranslation();
  const [rules, setRules] = useState<readonly PermissionRuleRecord[] | undefined>(undefined);
  const [rulesFailed, setRulesFailed] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const categoriesOff = permissionCategoryIds.filter((id) => !preferences.categories[id]).length;

  const loadRules = useCallback(() => {
    void listRules()
      .then((records) => {
        setRules(records);
        setRulesFailed(false);
      })
      .catch((error: unknown) => {
        console.error("[renderer] listPermissionRules failed", error);
        setRulesFailed(true);
      });
  }, [listRules]);

  useEffect(() => {
    if (expanded && rules === undefined) {
      loadRules();
    }
  }, [expanded, loadRules, rules]);

  return (
    <>
      <SettingsGroup
        title={t("settings.permissions.groupMaster")}
        description={t("settings.permissions.groupMaster.description")}
      >
        <SettingsRow
          title={t("settings.permissions.enabled.title")}
          description={t("settings.permissions.enabled.description")}
        >
          <SettingsSwitch
            checked={preferences.enabled}
            label={t("settings.permissions.enabled.title")}
            onChange={onSetEnabled}
          />
        </SettingsRow>
      </SettingsGroup>

      <SettingsGroup
        title={t("settings.permissions.groupCommands")}
        description={t("settings.permissions.groupCommands.description")}
      >
        {COMMAND_CATEGORIES.map((category) => (
          <CategoryRow
            category={category}
            disabled={!preferences.enabled}
            key={category}
            preferences={preferences}
            onSetPreferences={onSetPreferences}
          />
        ))}
      </SettingsGroup>

      <SettingsGroup
        title={t("settings.permissions.groupFiles")}
        description={t("settings.permissions.groupFiles.description")}
      >
        {FILE_CATEGORIES.map((category) => (
          <CategoryRow
            category={category}
            disabled={!preferences.enabled}
            key={category}
            preferences={preferences}
            onSetPreferences={onSetPreferences}
          />
        ))}
      </SettingsGroup>

      <p className="settings-section__description">{t("settings.permissions.notice")}</p>

      <SettingsGroup
        title={t("settings.permissions.rules.title")}
        description={t("settings.permissions.rules.description")}
      >
        <SettingsRow
          title={t("settings.permissions.rules.rowTitle")}
          description={
            rules
              ? t("settings.permissions.rules.count", {
                  categories: permissionCategoryIds.length,
                  rules: rules.length,
                })
              : t("settings.permissions.rules.countUnknown")
          }
        >
          <button
            aria-expanded={expanded}
            className="button button--secondary"
            type="button"
            onClick={() => setExpanded((current) => !current)}
          >
            {expanded
              ? t("settings.permissions.rules.collapse")
              : t("settings.permissions.rules.expand")}
          </button>
        </SettingsRow>
        {expanded
          ? permissionCategoryIds.map((category) => (
              <RuleRow
                category={category}
                failed={rulesFailed}
                key={category}
                rules={rules?.filter((rule) => rule.category === category)}
              />
            ))
          : null}
      </SettingsGroup>

      {categoriesOff > 0 ? (
        <p className="settings-section__description">
          {t("settings.permissions.offSummary", { count: categoriesOff })}
        </p>
      ) : null}
    </>
  );
}

function CategoryRow({
  category,
  preferences,
  disabled,
  onSetPreferences,
}: {
  readonly category: PermissionCategoryId;
  readonly preferences: PermissionPreferences;
  readonly disabled: boolean;
  readonly onSetPreferences: (patch: PermissionPreferencesPatch) => void;
}) {
  const { t } = useTranslation();
  const copy = CATEGORY_COPY[category];
  const title = t(copy.title);
  return (
    <SettingsRow title={title} description={t(copy.description)}>
      <SettingsSwitch
        checked={preferences.categories[category] === true}
        disabled={disabled}
        label={title}
        onChange={(checked) => onSetPreferences({ categories: { [category]: checked } })}
      />
    </SettingsRow>
  );
}

function RuleRow({
  category,
  rules,
  failed,
}: {
  readonly category: PermissionCategoryId;
  readonly rules: readonly PermissionRuleRecord[] | undefined;
  readonly failed: boolean;
}) {
  const { t } = useTranslation();
  const copy = CATEGORY_COPY[category];
  const description = failed
    ? t("settings.permissions.rules.loadFailed")
    : (rules ?? []).map((rule) => rule.reason).join(" · ");
  return <SettingsRow title={t(copy.title)} description={description} />;
}
