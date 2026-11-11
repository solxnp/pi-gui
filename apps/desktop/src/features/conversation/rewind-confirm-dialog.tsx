import { useEffect, useState } from "react";
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
  readonly onConfirm: (paths: readonly string[]) => void;
}) {
  const { t } = useTranslation();
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());

  // Every file starts selected: rewinding the whole turn is the common case.
  useEffect(() => {
    setSelected(new Set(state.entries.map((entry) => entry.path)));
  }, [state.entries]);

  const toggle = (path: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  };
  const chosen = state.entries.filter((entry) => selected.has(entry.path));
  const restored = chosen.filter((entry) => entry.change === "restore");
  const removed = chosen.filter((entry) => entry.change === "remove");

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
                <label className="rewind-confirm__pick">
                  <input
                    checked={selected.has(entry.path)}
                    data-testid="rewind-confirm-file"
                    type="checkbox"
                    onChange={() => toggle(entry.path)}
                  />
                  <span className="rewind-confirm__path">{entry.path}</span>
                </label>
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
            disabled={state.loading || Boolean(state.failure) || chosen.length === 0}
            type="button"
            onClick={() => onConfirm(chosen.map((entry) => entry.path))}
          >
            {t("rewind.confirm.apply")}
          </button>
        </div>
      </div>
    </div>
  );
}
