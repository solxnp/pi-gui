import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PiDesktopApi } from "../../../../contracts/ipc";
import { useTranslation } from "../../../i18n";
import { ChevronDownIcon, ChevronRightIcon, RefreshIcon } from "../../../ui/icons";
import {
  parseTasksBoard,
  TASKS_BOARD_FILES,
  type TasksBoard,
  type TasksBoardGroup,
} from "./parse-tasks";

interface TasksBoardPanelProps {
  readonly api: PiDesktopApi | undefined;
  readonly workspaceId: string;
  /** Puts a prompt about the clicked row in the composer; the user still presses send. */
  readonly onInsertPrompt: (prompt: string) => void;
}

type LoadState =
  | { readonly kind: "loading" }
  | { readonly kind: "missing" }
  | { readonly kind: "error"; readonly message: string }
  | {
      readonly kind: "ready";
      readonly path: string;
      readonly board: TasksBoard;
      readonly truncated: boolean;
    };

const MISSING_FILE = /ENOENT|no such file|not found/i;

function statusClassName(status: TasksBoardGroup["status"]): string {
  return `tasks-board__badge tasks-board__badge--${status}`;
}

export function TasksBoardPanel({ api, workspaceId, onInsertPrompt }: TasksBoardPanelProps) {
  const { t } = useTranslation();
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set());
  const [reloadToken, setReloadToken] = useState(0);
  const requestId = useRef(0);

  useEffect(() => {
    if (!api || !workspaceId) {
      setState({ kind: "missing" });
      return;
    }
    const current = ++requestId.current;
    setState({ kind: "loading" });
    (async () => {
      let missing = true;
      let failure = "";
      for (const path of TASKS_BOARD_FILES) {
        try {
          const preview = await api.readWorkspaceFile(workspaceId, path);
          if (current !== requestId.current) return;
          if (preview.binary) {
            missing = false;
            failure = t("tasksBoard.binary", { path });
            continue;
          }
          setState({
            kind: "ready",
            path,
            board: parseTasksBoard(preview.content),
            truncated: preview.truncated,
          });
          return;
        } catch (error) {
          if (current !== requestId.current) return;
          const message = error instanceof Error ? error.message : String(error);
          if (!MISSING_FILE.test(message)) {
            missing = false;
            failure = t("tasksBoard.readFailed", { path, message });
          }
        }
      }
      setState(missing && !failure ? { kind: "missing" } : { kind: "error", message: failure });
    })().catch(() => {
      // The panel reports read failures as state; it never rejects on its own.
    });
  }, [api, workspaceId, reloadToken, t]);

  const groups = state.kind === "ready" ? state.board.groups : [];
  const badge = useMemo(
    () => ({
      doing: t("tasksBoard.status.doing"),
      todo: t("tasksBoard.status.todo"),
      other: t("tasksBoard.status.other"),
    }),
    [t],
  );

  const toggleGroup = useCallback((id: string) => {
    setCollapsed((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const askAbout = (label: string) => {
    onInsertPrompt(t("tasksBoard.prompt", { item: label }));
  };

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
          onClick={() => setReloadToken((token) => token + 1)}
          title={t("tasksBoard.refresh")}
          type="button"
        >
          <RefreshIcon />
        </button>
      </header>

      {state.kind === "ready" && (state.board.openItems > 0 || state.board.doneItems > 0) ? (
        <p className="tasks-board__summary">
          {t("tasksBoard.summary", {
            open: state.board.openItems,
            done: state.board.doneItems,
          })}
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
        <ul className="tasks-board__groups">
          {groups.map((group) => {
            const isCollapsed = collapsed.has(group.id);
            const open = group.items.filter((item) => !item.done).length;
            return (
              <li className="tasks-board__group" key={group.id}>
                <button
                  aria-expanded={!isCollapsed}
                  className="tasks-board__group-toggle"
                  onClick={() => toggleGroup(group.id)}
                  type="button"
                >
                  <span className="tasks-board__chevron">
                    {isCollapsed ? <ChevronRightIcon /> : <ChevronDownIcon />}
                  </span>
                  <span className={statusClassName(group.status)} title={group.statusText}>
                    {badge[group.status]}
                  </span>
                  <span className="tasks-board__group-title">
                    {group.title || t("tasksBoard.untitled")}
                  </span>
                  {group.items.length > 0 ? (
                    <span className="tasks-board__count">{open}</span>
                  ) : null}
                </button>
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
                          onClick={() =>
                            askAbout(group.title ? `${group.title} — ${item.text}` : item.text)
                          }
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
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
