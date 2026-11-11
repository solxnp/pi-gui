import { useEffect, useMemo, useState } from "react";
import type { PiDesktopApi, TasksBoardTaskStatus } from "../../../../contracts/ipc";
import { useTranslation } from "../../../i18n";
import { ChevronDownIcon, ChevronRightIcon, RefreshIcon } from "../../../ui/icons";
import type { TasksBoardGroup, TasksBoardStatus } from "./parse-tasks";
import { useTasksLedger, useTasksProjectCounts } from "./use-tasks-ledger";

export interface TasksBoardProject {
  readonly id: string;
  readonly name: string;
  /** Worktrees share their root's ledger, so only roots are listed. */
  readonly kind: "primary" | "worktree";
}

interface TasksBoardPanelProps {
  readonly api: PiDesktopApi | undefined;
  /** The workspace of the open thread; the switcher starts here. */
  readonly workspaceId: string;
  readonly workspaces: readonly TasksBoardProject[];
  /** Puts a prompt about the clicked row in the composer; the user still presses send. */
  readonly onInsertPrompt: (prompt: string) => void;
}

const SECTIONS = [
  { status: "doing", folded: false },
  { status: "todo", folded: false },
  { status: "done", folded: true },
  { status: "cancelled", folded: true },
] as const satisfies readonly { status: TasksBoardStatus; folded: boolean }[];

/** A task marked 已完成 by hand but without a commit sha cannot be trusted. */
function needsCommit(group: TasksBoardGroup): boolean {
  return group.status === "done" && group.statusText.length > 0 && !group.commit;
}

const STATUS_OPTIONS: readonly TasksBoardTaskStatus[] = [
  "待做",
  "进行中",
  "待验证",
  "已完成",
  "取消",
];

/** The status the select shows: the raw cell wins, so 待验证 is not flattened into 待做. */
function currentStatusText(group: TasksBoardGroup): TasksBoardTaskStatus {
  const raw = group.statusText;
  const direct = STATUS_OPTIONS.find((option) => raw.startsWith(option));
  if (direct) return direct;
  if (group.status === "doing") return "进行中";
  if (group.status === "done") return "已完成";
  if (group.status === "cancelled") return "取消";
  return "待做";
}

function statusClassName(status: TasksBoardStatus): string {
  return `tasks-board__badge tasks-board__badge--${status}`;
}

export function TasksBoardPanel({
  api,
  workspaceId,
  workspaces,
  onInsertPrompt,
}: TasksBoardPanelProps) {
  const { t } = useTranslation();
  const projects = useMemo(
    () => workspaces.filter((workspace) => workspace.kind === "primary"),
    [workspaces],
  );
  const [selectedId, setSelectedId] = useState(workspaceId);
  useEffect(() => setSelectedId(workspaceId), [workspaceId]);

  const selected =
    projects.find((project) => project.id === selectedId) ??
    projects.find((project) => project.id === workspaceId);
  const selectedWorkspaceId = selected?.id ?? workspaceId;
  const { state, reload } = useTasksLedger(api, selectedWorkspaceId);
  const counts = useTasksProjectCounts(
    api,
    projects.map((project) => project.id),
  );

  const [draft, setDraft] = useState("");
  const [statusError, setStatusError] = useState("");
  const [busyTask, setBusyTask] = useState("");
  const [addError, setAddError] = useState("");
  const [adding, setAdding] = useState(false);
  const [collapsedGroups, setCollapsedGroups] = useState<ReadonlySet<string>>(() => new Set());
  const [openSections, setOpenSections] = useState<ReadonlySet<string>>(() => new Set());

  const toggleGroup = (id: string) => {
    setCollapsedGroups((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const toggleSection = (status: string) => {
    setOpenSections((previous) => {
      const next = new Set(previous);
      if (next.has(status)) next.delete(status);
      else next.add(status);
      return next;
    });
  };

  const groups = state.kind === "ready" ? state.board.groups : [];
  const labels: Record<TasksBoardStatus, string> = {
    doing: t("tasksBoard.status.doing"),
    todo: t("tasksBoard.status.todo"),
    done: t("tasksBoard.status.done"),
    cancelled: t("tasksBoard.status.cancelled"),
  };

  const askAbout = (label: string) => onInsertPrompt(t("tasksBoard.prompt", { item: label }));
  const modifiedAtMs = state.kind === "ready" ? state.modifiedAtMs : undefined;
  const changeStatus = (group: TasksBoardGroup, status: TasksBoardTaskStatus) => {
    if (!api || busyTask) return;
    setBusyTask(group.title);
    setStatusError("");
    api
      .updateTasksBoardTaskStatus({
        workspaceId: selectedWorkspaceId,
        task: group.title,
        status,
        expectedModifiedAtMs: modifiedAtMs,
      })
      .then(() => reload())
      .catch((error: unknown) => {
        setStatusError(error instanceof Error ? error.message : String(error));
      })
      .finally(() => setBusyTask(""));
  };

  const submitNewTask = () => {
    const title = draft.trim();
    if (!api || adding || title.length === 0) return;
    setAdding(true);
    setAddError("");
    api
      .createTasksBoardTask({
        workspaceId: selectedWorkspaceId,
        title,
        expectedModifiedAtMs: modifiedAtMs,
      })
      .then(() => {
        setDraft("");
        reload();
      })
      .catch((error: unknown) => {
        setAddError(error instanceof Error ? error.message : String(error));
      })
      .finally(() => setAdding(false));
  };
  const askRow = (group: TasksBoardGroup, text: string) =>
    askAbout(group.title ? `${group.title} — ${text}` : text);

  return (
    <section className="tasks-board" data-testid="tasks-board">
      <header className="tasks-board__header">
        <div className="tasks-board__heading">
          <h2>{t("tasksBoard.title")}</h2>
          {state.kind === "ready" ? (
            <span className="tasks-board__path" title={state.path}>
              {state.path}
              {state.truncated ? ` ${t("tasksBoard.truncated")}` : ""}
            </span>
          ) : null}
        </div>
        <button
          aria-label={t("tasksBoard.refresh")}
          className="tasks-board__icon-button"
          onClick={reload}
          title={t("tasksBoard.refresh")}
          type="button"
        >
          <RefreshIcon />
        </button>
      </header>

      {projects.length > 0 ? (
        <div className="tasks-board__project">
          <label className="tasks-board__project-label" htmlFor="tasks-board-project">
            {t("tasksBoard.project")}
          </label>
          <select
            className="tasks-board__project-select"
            data-testid="tasks-board-project"
            id="tasks-board-project"
            onChange={(event) => setSelectedId(event.target.value)}
            value={selectedWorkspaceId}
          >
            {projects.map((project) => {
              const count = counts[project.id];
              return (
                <option key={project.id} value={project.id}>
                  {count
                    ? t("tasksBoard.projectOption", {
                        name: project.name,
                        doing: count.doing,
                        todo: count.todo,
                      })
                    : project.name}
                </option>
              );
            })}
          </select>
        </div>
      ) : null}

      <form
        className="tasks-board__add"
        onSubmit={(event) => {
          event.preventDefault();
          submitNewTask();
        }}
      >
        <input
          aria-label={t("tasksBoard.addPlaceholder")}
          className="tasks-board__add-input"
          data-testid="tasks-board-new-title"
          onChange={(event) => setDraft(event.target.value)}
          placeholder={t("tasksBoard.addPlaceholder")}
          value={draft}
        />
        <button
          className="tasks-board__add-button"
          data-testid="tasks-board-add"
          disabled={adding || draft.trim().length === 0}
          type="submit"
        >
          {t("tasksBoard.add")}
        </button>
      </form>
      {statusError ? (
        <p className="tasks-board__notice tasks-board__notice--error" role="alert">
          {t("tasksBoard.statusFailed", { message: statusError })}
        </p>
      ) : null}
      {addError ? (
        <p className="tasks-board__notice tasks-board__notice--error" role="alert">
          {t("tasksBoard.addFailed", { message: addError })}
        </p>
      ) : null}

      {state.kind === "loading" ? (
        <p className="tasks-board__notice" role="status">
          {t("tasksBoard.loading")}
        </p>
      ) : state.kind === "missing" ? (
        <div className="tasks-board__empty" role="status">
          <h3>{t("tasksBoard.missing.title")}</h3>
          <p>{t("tasksBoard.missing.body")}</p>
        </div>
      ) : state.kind === "error" ? (
        <p className="tasks-board__notice tasks-board__notice--error" role="alert">
          {state.message}
        </p>
      ) : groups.length === 0 ? (
        <p className="tasks-board__notice" role="status">
          {t("tasksBoard.empty")}
        </p>
      ) : (
        <div className="tasks-board__groups">
          {SECTIONS.map(({ status, folded }) => {
            const sectionGroups = groups.filter((group) => group.status === status);
            if (sectionGroups.length === 0) return null;
            const open = openSections.has(status);
            return (
              <section
                className={`tasks-board__section tasks-board__section--${status}`}
                data-testid={`tasks-board-section-${status}`}
                key={status}
              >
                <button
                  aria-expanded={folded ? open : true}
                  className="tasks-board__section-toggle"
                  onClick={() => toggleSection(status)}
                  type="button"
                >
                  <span className="tasks-board__chevron">
                    {folded && !open ? <ChevronRightIcon /> : <ChevronDownIcon />}
                  </span>
                  <span className={statusClassName(status)}>{labels[status]}</span>
                  <span className="tasks-board__count">{sectionGroups.length}</span>
                </button>
                {folded && !open
                  ? null
                  : sectionGroups.map((group) => {
                      const isCollapsed = collapsedGroups.has(group.id);
                      const pending = group.items.filter((item) => !item.done).length;
                      return (
                        <div className="tasks-board__group" key={group.id}>
                          <div className="tasks-board__group-head">
                            <button
                              aria-expanded={!isCollapsed}
                              className="tasks-board__group-toggle"
                              onClick={() => toggleGroup(group.id)}
                              type="button"
                            >
                              <span className="tasks-board__chevron">
                                {isCollapsed ? <ChevronRightIcon /> : <ChevronDownIcon />}
                              </span>
                              <span
                                className="tasks-board__group-title"
                                title={group.statusText || undefined}
                              >
                                {group.title || t("tasksBoard.untitled")}
                              </span>
                              {needsCommit(group) ? (
                                <span
                                  className="tasks-board__warn"
                                  data-testid="tasks-board-missing-commit"
                                  title={t("tasksBoard.missingCommit")}
                                >
                                  ⚠️
                                </span>
                              ) : null}
                              {group.items.length > 0 ? (
                                <span className="tasks-board__count">{pending}</span>
                              ) : null}
                            </button>
                            <select
                              aria-label={t("tasksBoard.statusLabel", { task: group.title })}
                              className="tasks-board__status-select"
                              data-testid="tasks-board-status"
                              disabled={busyTask.length > 0}
                              onChange={(event) =>
                                changeStatus(group, event.target.value as TasksBoardTaskStatus)
                              }
                              value={currentStatusText(group)}
                            >
                              {STATUS_OPTIONS.map((option) => (
                                <option
                                  disabled={option === "已完成" && !group.commit}
                                  key={option}
                                  value={option}
                                >
                                  {option}
                                </option>
                              ))}
                            </select>
                          </div>
                          {isCollapsed ? null : group.items.length === 0 ? (
                            <button
                              className="tasks-board__ask"
                              onClick={() => askAbout(group.title)}
                              type="button"
                            >
                              {t("tasksBoard.ask")}
                            </button>
                          ) : (
                            <ul className="tasks-board__items">
                              {group.items.map((item) => (
                                <li key={item.id}>
                                  <button
                                    className={`tasks-board__item${item.done ? " tasks-board__item--done" : ""}`}
                                    onClick={() => askRow(group, item.text)}
                                    title={t("tasksBoard.ask")}
                                    type="button"
                                  >
                                    <span className="tasks-board__check" aria-hidden="true">
                                      {item.done ? "✓" : "☐"}
                                    </span>
                                    <span>{item.text}</span>
                                  </button>
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                      );
                    })}
              </section>
            );
          })}
        </div>
      )}
    </section>
  );
}
