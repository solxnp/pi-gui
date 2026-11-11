import {
  networkResumeMaxAttemptOptions,
  type NetworkResumeMaxAttempts,
  type NetworkResumePreferences,
  type NetworkResumePreferencesPatch,
  type NetworkResumeWaitingRecord,
} from "../../../contracts/network-resume";
import { useTranslation } from "../../i18n";
import { SettingsSelect, SettingsSwitch } from "./settings-controls";
import { SettingsGroup, SettingsRow, SettingsRow as Row } from "./settings-utils";

interface SettingsNetworkResumeSectionProps {
  readonly preferences: NetworkResumePreferences;
  readonly waiting: readonly NetworkResumeWaitingRecord[];
  readonly onSetPreferences: (patch: NetworkResumePreferencesPatch) => void;
}

/**
 * The watcher's settings and the threads it is currently holding. The waiting list is the point:
 * without it an automatic "continue" would look like the app typing on its own.
 */
export function SettingsNetworkResumeSection({
  preferences,
  waiting,
  onSetPreferences,
}: SettingsNetworkResumeSectionProps) {
  const { t } = useTranslation();

  return (
    <>
      <SettingsGroup
        title={t("settings.networkResume.group")}
        description={t("settings.networkResume.group.description")}
      >
        <Row
          title={t("settings.networkResume.enabled.title")}
          description={t("settings.networkResume.enabled.description")}
        >
          <SettingsSwitch
            checked={preferences.enabled}
            label={t("settings.networkResume.enabled.title")}
            onChange={(enabled) => onSetPreferences({ enabled })}
          />
        </Row>
        <Row
          title={t("settings.networkResume.limit.title")}
          description={t("settings.networkResume.limit.description")}
        >
          <SettingsSelect
            label={t("settings.networkResume.limit.title")}
            options={networkResumeMaxAttemptOptions.map((attempts) => ({
              value: String(attempts),
              label:
                attempts === 0
                  ? t("settings.networkResume.limit.unlimited")
                  : t("settings.networkResume.limit.attempts", { count: attempts }),
            }))}
            value={String(preferences.maxAttempts)}
            onChange={(value) =>
              onSetPreferences({ maxAttempts: Number(value) as NetworkResumeMaxAttempts })
            }
          />
        </Row>
      </SettingsGroup>

      <SettingsGroup
        title={t("settings.networkResume.waiting.title")}
        description={t("settings.networkResume.waiting.description")}
      >
        {waiting.length === 0 ? (
          <Row title={t("settings.networkResume.waiting.empty")} />
        ) : (
          waiting.map((record) => (
            <SettingsRow
              description={record.errorMessage}
              key={`${record.workspaceId}:${record.sessionId}`}
              title={record.title ?? t("settings.networkResume.waiting.untitled")}
            >
              <span className="settings-row__value">
                {record.exhausted
                  ? t("settings.networkResume.waiting.exhausted")
                  : t("settings.networkResume.waiting.attempts", {
                      count: record.attempts,
                    })}
              </span>
            </SettingsRow>
          ))
        )}
      </SettingsGroup>

      <p className="settings-section__description">{t("settings.networkResume.note")}</p>
    </>
  );
}
