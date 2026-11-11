import { useCallback, useEffect, useState } from "react";
import type { CustomInstructionsSnapshot } from "../../../contracts/ipc";
import { useTranslation } from "../../i18n";
import { SettingsGroup, SettingsRow } from "./settings-utils";

interface SettingsInstructionsSectionProps {
  readonly onRead: () => Promise<CustomInstructionsSnapshot>;
  readonly onSave: (content: string) => Promise<CustomInstructionsSnapshot>;
}

/**
 * The instructions file is read again before every run, so closing the editor is what applies the
 * change: the saved file is in effect for the next message, and no restart is involved.
 */
export function SettingsInstructionsSection({ onRead, onSave }: SettingsInstructionsSectionProps) {
  const { t } = useTranslation();
  const [snapshot, setSnapshot] = useState<CustomInstructionsSnapshot>();
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    let cancelled = false;
    void onRead()
      .then((next) => {
        if (!cancelled) {
          setSnapshot(next);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setError(t("settings.instructions.readFailed"));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [onRead, t]);

  const openEditor = useCallback(() => {
    setDraft(snapshot?.content ?? "");
    setError(undefined);
    setEditing(true);
  }, [snapshot]);

  const closeEditor = useCallback(
    (save: boolean) => {
      setEditing(false);
      if (!save) {
        return;
      }
      void onSave(draft)
        .then(setSnapshot)
        .catch(() => setError(t("settings.instructions.saveFailed")));
    },
    [draft, onSave, t],
  );

  return (
    <>
      <SettingsGroup title={t("settings.instructions.group")}>
        <SettingsRow
          title={t("settings.instructions.title")}
          description={t("settings.instructions.description")}
        >
          <div className="instructions-path">
            <input
              aria-label={t("settings.instructions.pathLabel")}
              className="instructions-path__input"
              data-testid="instructions-path"
              disabled
              readOnly
              title={snapshot?.path ?? ""}
              value={snapshot?.path ?? ""}
            />
            <button
              className="button button--secondary"
              data-testid="instructions-edit"
              type="button"
              onClick={openEditor}
            >
              {t("settings.instructions.edit")}
            </button>
          </div>
        </SettingsRow>
      </SettingsGroup>
      {error ? <p className="settings-error">{error}</p> : null}
      {editing ? (
        <div className="extension-dialog-backdrop" data-testid="instructions-editor-backdrop">
          <div
            aria-modal="true"
            className="extension-dialog"
            data-testid="instructions-editor"
            role="dialog"
          >
            <div className="extension-dialog__title">{t("settings.instructions.editorTitle")}</div>
            <p className="extension-dialog__body">{t("settings.instructions.editorHint")}</p>
            <textarea
              className="extension-dialog__editor"
              data-testid="instructions-textarea"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
            />
            <div className="extension-dialog__actions">
              <button
                className="button button--secondary"
                data-testid="instructions-cancel"
                type="button"
                onClick={() => closeEditor(false)}
              >
                {t("settings.instructions.cancel")}
              </button>
              <button
                className="button button--primary"
                data-testid="instructions-save"
                type="button"
                onClick={() => closeEditor(true)}
              >
                {t("settings.instructions.save")}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
