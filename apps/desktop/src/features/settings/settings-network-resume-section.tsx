import {
  networkResumeGiveUpOptions,
  networkResumeIntervalOptions,
  networkResumeMaxAttemptOptions,
  networkResumeSuccessOptions,
  type NetworkResumeGiveUpAfter,
  type NetworkResumeIntervalMs,
  type NetworkResumeMaxAttempts,
  type NetworkResumePreferences,
  type NetworkResumePreferencesPatch,
  type NetworkResumeSuccesses,
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
 *
 * Every select writes straight through to the main process, which restarts the probe loop on the
 * spot, so a change here is in effect on the next check rather than after a restart.
 */
export function SettingsNetworkResumeSection({
  preferences,
  waiting,
  onSetPreferences,
}: SettingsNetworkResumeSectionProps) {
  const { t } = useTranslation();
  const intervalLabel = (ms: NetworkResumeIntervalMs): string =>
    ms < 60_000
      ? t("settings.networkResume.interval.seconds", { count: ms / 1000 })
      : t("settings.networkResume.interval.minutes", { count: ms / 60_000 });

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
          title={t("settings.networkResume.interval.title")}
          description={t("settings.networkResume.interval.description")}
        >
          <SettingsSelect
            label={t("settings.networkResume.interval.title")}
            options={networkResumeIntervalOptions.map((ms) => ({
              value: String(ms),
              label: intervalLabel(ms),
            }))}
            value={String(preferences.probeIntervalMs)}
            onChange={(value) =>
              onSetPreferences({ probeIntervalMs: Number(value) as NetworkResumeIntervalMs })
            }
          />
        </Row>
        <Row
          title={t("settings.networkResume.streak.title")}
          description={t("settings.networkResume.streak.description")}
        >
          <SettingsSelect
            label={t("settings.networkResume.streak.title")}
            options={networkResumeSuccessOptions.map((count) => ({
              value: String(count),
              label: t("settings.networkResume.streak.count", { count }),
            }))}
            value={String(preferences.consecutiveSuccesses)}
            onChange={(value) =>
              onSetPreferences({ consecutiveSuccesses: Number(value) as NetworkResumeSuccesses })
            }
          />
        </Row>
        <Row
          title={t("settings.networkResume.giveUp.title")}
          description={t("settings.networkResume.giveUp.description")}
        >
          <SettingsSelect
            label={t("settings.networkResume.giveUp.title")}
            options={networkResumeGiveUpOptions.map((count) => ({
              value: String(count),
              label:
                count === 0
                  ? t("settings.networkResume.giveUp.never")
                  : t("settings.networkResume.giveUp.count", { count }),
            }))}
            value={String(preferences.giveUpAfterFailedProbes)}
            onChange={(value) =>
              onSetPreferences({
                giveUpAfterFailedProbes: Number(value) as NetworkResumeGiveUpAfter,
              })
            }
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
                {(record.failedProbes ?? 0) > 0
                  ? ` · ${t("settings.networkResume.waiting.probes", {
                      count: record.failedProbes ?? 0,
                    })}`
                  : ""}
              </span>
            </SettingsRow>
          ))
        )}
      </SettingsGroup>

      <p className="settings-section__description">{t("settings.networkResume.note")}</p>
    </>
  );
}
