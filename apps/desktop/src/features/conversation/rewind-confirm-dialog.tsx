import type { RewindEntryRecord } from "../../../contracts/ipc";
import { useTranslation } from "../../i18n";

export interface RewindConfirmState {
  readonly checkpointId: string;
  readonly loading: boolean;
  readonly entries: readonly RewindEntryRecord[];
  readonly failure?: string;
}

/**
 * Shows what a rewind would change before it happens. The list comes from the same plan the restore
 * uses, so the count here is the count that lands on disk.
 */
export function RewindConfirmDialog({
  state,
  onCancel,
  onConfirm,
}: {
  readonly state: RewindConfirmState;
  readonly onCancel: () => void;
  readonly onConfirm: () => void;
}) {
  const { t } = useTranslation();

  const restored = state.entries.filter((entry) => entry.change === "restore");
  const removed = state.entries.filter((entry) => entry.change === "remove");

  return (
    <div className="extension-dialog-backdrop">
      <div
        aria-modal="true"
        className="extension-dialog rewind-confirm"
        data-testid="rewind-confirm"
        role="dialog"
      >
        <div className="extension-dialog__title">{t("rewind.confirm.title")}</div>
        <p className="extension-dialog__body">{t("rewind.confirm.body")}</p>

        {state.loading ? (
          <p className="rewind-confirm__hint">{t("rewind.confirm.loading")}</p>
        ) : null}
        {state.failure ? (
          <p className="settings-error" data-testid="rewind-confirm-failure">
            {state.failure}
          </p>
        ) : null}

        {state.entries.length > 0 ? (
          <ul className="rewind-confirm__files" data-testid="rewind-confirm-files">
            {state.entries.map((entry) => (
              <li key={`${entry.change}:${entry.path}`}>
                <span className="rewind-confirm__path">{entry.path}</span>
                <span className="rewind-confirm__stat">
                  {entry.change === "remove"
                    ? t("rewind.confirm.willDelete")
                    : `+${entry.additions} −${entry.deletions}`}
                </span>
              </li>
            ))}
          </ul>
        ) : null}

        {state.entries.length > 0 ? (
          <p className="rewind-confirm__hint" data-testid="rewind-confirm-summary">
            {t("rewind.confirm.summary", {
              restored: restored.length,
              removed: removed.length,
            })}
          </p>
        ) : null}

        <div className="extension-dialog__actions">
          <button
            className="button button--secondary"
            data-testid="rewind-confirm-cancel"
            type="button"
            onClick={onCancel}
          >
            {t("rewind.confirm.cancel")}
          </button>
          <button
            className="button button--primary"
            data-testid="rewind-confirm-apply"
            disabled={state.loading || Boolean(state.failure) || state.entries.length === 0}
            type="button"
            onClick={onConfirm}
          >
            {t("rewind.confirm.apply")}
          </button>
        </div>
      </div>
    </div>
  );
}
