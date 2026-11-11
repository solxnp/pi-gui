import { useCallback, useEffect, useState } from "react";
import type {
  RecallProjectEntry,
  RecallProjectsProblem,
  RecallProjectsSaveResult,
  RecallProjectsSnapshot,
} from "../../../contracts/ipc";
import { useTranslation, type MessageKey } from "../../i18n";
import { SettingsGroup, SettingsRow } from "./settings-utils";

interface SettingsRecallProjectsSectionProps {
  readonly onRead: () => Promise<RecallProjectsSnapshot>;
  readonly onSave: (projects: readonly RecallProjectEntry[]) => Promise<RecallProjectsSaveResult>;
}

interface Draft {
  readonly name: string;
  readonly path: string;
  readonly sessionDir: string;
  readonly note: string;
}

type Dialog =
  | { readonly mode: "add" }
  | { readonly mode: "edit"; readonly index: number }
  | { readonly mode: "delete"; readonly index: number };

const EMPTY_DRAFT: Draft = { name: "", path: "", sessionDir: "", note: "" };

const PROBLEM_KEYS: Readonly<Record<RecallProjectsProblem["code"], MessageKey>> = {
  notAList: "settings.recallProjects.problem.notAList",
  tooManyEntries: "settings.recallProjects.problem.tooManyEntries",
  notAnObject: "settings.recallProjects.problem.notAnObject",
  nameEmpty: "settings.recallProjects.problem.nameEmpty",
  nameDuplicate: "settings.recallProjects.problem.nameDuplicate",
  nameTooLong: "settings.recallProjects.problem.nameTooLong",
  pathMissing: "settings.recallProjects.problem.pathMissing",
  pathNotAbsolute: "settings.recallProjects.problem.pathNotAbsolute",
  pathTooLong: "settings.recallProjects.problem.pathTooLong",
  pathNotDirectory: "settings.recallProjects.problem.pathNotDirectory",
  sessionDirInvalid: "settings.recallProjects.problem.sessionDirInvalid",
  sessionDirMissing: "settings.recallProjects.problem.sessionDirMissing",
};

/**
 * The `recall` extension reads this list on every call, but pi only reloads extensions on
 * `/reload`, so the page says so instead of pretending a save takes effect immediately.
 */
export function SettingsRecallProjectsSection({
  onRead,
  onSave,
}: SettingsRecallProjectsSectionProps) {
  const { t } = useTranslation();
  const [snapshot, setSnapshot] = useState<RecallProjectsSnapshot>();
  const [dialog, setDialog] = useState<Dialog>();
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [problems, setProblems] = useState<readonly RecallProjectsProblem[]>([]);
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
          setError(t("settings.recallProjects.readFailed"));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [onRead, t]);

  const openAdd = useCallback(() => {
    setDraft(EMPTY_DRAFT);
    setProblems([]);
    setError(undefined);
    setDialog({ mode: "add" });
  }, []);

  const openEdit = useCallback(
    (index: number) => {
      const project = snapshot?.projects[index];
      if (!project) {
        return;
      }
      setDraft({
        name: project.name,
        path: project.path,
        sessionDir: project.sessionDir ?? "",
        note: project.note ?? "",
      });
      setProblems([]);
      setError(undefined);
      setDialog({ mode: "edit", index });
    },
    [snapshot],
  );

  const closeDialog = useCallback(() => {
    setDialog(undefined);
    setProblems([]);
  }, []);

  const apply = useCallback(
    (next: readonly RecallProjectEntry[]) => {
      void onSave(next)
        .then((result) => {
          if (result.ok) {
            setSnapshot(result.snapshot);
            setDialog(undefined);
            setProblems([]);
            return;
          }
          setProblems(result.problems);
        })
        .catch(() => setError(t("settings.recallProjects.saveFailed")));
    },
    [onSave, t],
  );

  const submitDraft = useCallback(() => {
    if (dialog?.mode !== "add" && dialog?.mode !== "edit") {
      return;
    }
    const entry: RecallProjectEntry = {
      name: draft.name.trim(),
      path: draft.path.trim(),
      ...(draft.sessionDir.trim() ? { sessionDir: draft.sessionDir.trim() } : {}),
      ...(draft.note.trim() ? { note: draft.note.trim() } : {}),
    };
    const current = snapshot?.projects ?? [];
    const next =
      dialog.mode === "add"
        ? [...current, entry]
        : current.map((project, index) => (index === dialog.index ? entry : project));
    apply(next);
  }, [apply, dialog, draft, snapshot]);

  const confirmDelete = useCallback(() => {
    if (dialog?.mode !== "delete") {
      return;
    }
    const next = (snapshot?.projects ?? []).filter((_project, index) => index !== dialog.index);
    apply(next);
  }, [apply, dialog, snapshot]);

  const projects = snapshot?.projects ?? [];
  const problemKey = snapshot?.problem
    ? snapshot.problem === "invalidJson"
      ? t("settings.recallProjects.problem.invalidJson")
      : t("settings.recallProjects.problem.invalidShape")
    : undefined;
  const editing = dialog?.mode === "add" || dialog?.mode === "edit";

  return (
    <>
      <SettingsGroup
        title={t("settings.recallProjects.group")}
        description={t("settings.recallProjects.description")}
      >
        {projects.length === 0 ? (
          <div className="settings-row">
            <div className="settings-row__label">
              <div className="settings-row__description">{t("settings.recallProjects.empty")}</div>
            </div>
          </div>
        ) : (
          projects.map((project, index) => (
            <SettingsRow
              key={`${project.name}-${index}`}
              title={project.name}
              description={[project.path, project.sessionDir, project.note]
                .filter(Boolean)
                .join(" · ")}
            >
              <div className="settings-row__actions">
                <button
                  className="button button--secondary"
                  data-testid={`recall-project-edit-${index}`}
                  type="button"
                  onClick={() => openEdit(index)}
                >
                  {t("settings.recallProjects.edit")}
                </button>
                <button
                  className="button button--secondary"
                  data-testid={`recall-project-delete-${index}`}
                  type="button"
                  onClick={() => {
                    setProblems([]);
                    setError(undefined);
                    setDialog({ mode: "delete", index });
                  }}
                >
                  {t("settings.recallProjects.delete")}
                </button>
              </div>
            </SettingsRow>
          ))
        )}
      </SettingsGroup>

      <SettingsGroup title={t("settings.recallProjects.configGroup")}>
        <SettingsRow
          title={t("settings.recallProjects.pathTitle")}
          description={t("settings.recallProjects.reloadHint")}
        >
          <div className="recall-projects__controls">
            <input
              aria-label={t("settings.recallProjects.pathLabel")}
              className="instructions-path__input"
              data-testid="recall-projects-path"
              disabled
              readOnly
              title={snapshot?.path ?? ""}
              value={snapshot?.path ?? ""}
            />
            <button
              className="button button--primary"
              data-testid="recall-project-add"
              type="button"
              onClick={openAdd}
            >
              {t("settings.recallProjects.add")}
            </button>
          </div>
        </SettingsRow>
      </SettingsGroup>

      {problemKey ? (
        <p className="settings-error" data-testid="recall-projects-config-problem">
          {problemKey}
        </p>
      ) : null}
      {error ? (
        <p className="settings-error" data-testid="recall-projects-error">
          {error}
        </p>
      ) : null}
      {problems.length > 0 ? (
        <ul className="recall-projects__problems" data-testid="recall-projects-problems">
          {problems.map((problem, index) => (
            <li key={`${problem.code}-${problem.index ?? index}-${index}`}>
              {formatProblem(t, problem)}
            </li>
          ))}
        </ul>
      ) : null}

      {editing ? (
        <div className="extension-dialog-backdrop" data-testid="recall-project-backdrop">
          <div
            aria-modal="true"
            className="extension-dialog"
            data-testid="recall-project-dialog"
            role="dialog"
          >
            <div className="extension-dialog__title">
              {dialog.mode === "add"
                ? t("settings.recallProjects.dialogAdd")
                : t("settings.recallProjects.dialogEdit")}
            </div>
            <p className="extension-dialog__body">{t("settings.recallProjects.dialogHint")}</p>
            <label className="recall-projects__field">
              <span>{t("settings.recallProjects.nameLabel")}</span>
              <input
                className="recall-projects__input"
                data-testid="recall-project-name"
                placeholder={t("settings.recallProjects.namePlaceholder")}
                value={draft.name}
                onChange={(event) => setDraft({ ...draft, name: event.target.value })}
              />
            </label>
            <label className="recall-projects__field">
              <span>{t("settings.recallProjects.pathFieldLabel")}</span>
              <input
                className="recall-projects__input"
                data-testid="recall-project-path-input"
                placeholder={t("settings.recallProjects.pathPlaceholder")}
                value={draft.path}
                onChange={(event) => setDraft({ ...draft, path: event.target.value })}
              />
            </label>
            <label className="recall-projects__field">
              <span>{t("settings.recallProjects.sessionDirLabel")}</span>
              <input
                className="recall-projects__input"
                data-testid="recall-project-session-dir"
                placeholder={t("settings.recallProjects.sessionDirPlaceholder")}
                value={draft.sessionDir}
                onChange={(event) => setDraft({ ...draft, sessionDir: event.target.value })}
              />
            </label>
            <label className="recall-projects__field">
              <span>{t("settings.recallProjects.noteLabel")}</span>
              <input
                className="recall-projects__input"
                data-testid="recall-project-note"
                placeholder={t("settings.recallProjects.notePlaceholder")}
                value={draft.note}
                onChange={(event) => setDraft({ ...draft, note: event.target.value })}
              />
            </label>
            <div className="extension-dialog__actions">
              <button
                className="button button--secondary"
                data-testid="recall-project-cancel"
                type="button"
                onClick={closeDialog}
              >
                {t("settings.recallProjects.cancel")}
              </button>
              <button
                className="button button--primary"
                data-testid="recall-project-save"
                type="button"
                onClick={submitDraft}
              >
                {t("settings.recallProjects.save")}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {dialog?.mode === "delete" ? (
        <div className="extension-dialog-backdrop" data-testid="recall-project-delete-backdrop">
          <div
            aria-modal="true"
            className="extension-dialog"
            data-testid="recall-project-delete-dialog"
            role="dialog"
          >
            <div className="extension-dialog__title">
              {t("settings.recallProjects.deleteTitle")}
            </div>
            <p className="extension-dialog__body">{t("settings.recallProjects.deleteBody")}</p>
            <div className="extension-dialog__actions">
              <button
                className="button button--secondary"
                data-testid="recall-project-delete-cancel"
                type="button"
                onClick={closeDialog}
              >
                {t("settings.recallProjects.cancel")}
              </button>
              <button
                className="button button--primary"
                data-testid="recall-project-delete-confirm"
                type="button"
                onClick={confirmDelete}
              >
                {t("settings.recallProjects.deleteConfirm")}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

function formatProblem(
  t: ReturnType<typeof useTranslation>["t"],
  problem: RecallProjectsProblem,
): string {
  const head = problem.index === undefined ? "" : `${problem.index + 1}. `;
  const detail = problem.value ? `：${problem.value}` : "";
  return `${head}${t(PROBLEM_KEYS[problem.code])}${detail}`;
}
