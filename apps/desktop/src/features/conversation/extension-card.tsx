import type { ReactNode } from "react";
import type {
  ExtensionAction,
  ExtensionCard,
  ExtensionCardAnsweredForm,
  ExtensionCardTone,
  HostUiFormField,
} from "@pi-gui/session-driver";
import { useTranslation } from "../../i18n";
import { ExtensionIcon } from "../../ui/icons";

/** Asks the app to run one of the fixed actions an extension's button can name. */
export type RunExtensionAction = (action: ExtensionAction) => void;

/**
 * A card an extension declared with `pi.appendEntry("pi-gui.card", ...)`, drawn in the
 * "Edited N files" shell: tone as a word, rows and buttons like file rows. A pinned card adds
 * header controls and can collapse to its header.
 */
export function ExtensionCardItem({
  card,
  onAction,
  controls,
  collapsed = false,
}: {
  readonly card: ExtensionCard;
  readonly onAction?: RunExtensionAction;
  readonly controls?: ReactNode;
  readonly collapsed?: boolean;
}) {
  const { t } = useTranslation();
  const toneLabel = cardToneLabel(card.tone);
  const board = card.answeredForm;
  // The board already marks the picked option of every question, so the answer rows are dropped
  // under it: they repeat the answers and repeat each question as a row label. Rows still draw
  // for entries written before the board existed.
  const rows = board ? [] : card.rows;
  const hasBody = !collapsed && (board !== undefined || rows.length > 0 || card.actions.length > 0);
  return (
    <section
      className={`turn-changes extension-card extension-card--${card.tone}`}
      aria-label={card.title}
      data-testid="extension-card"
      data-card-key={card.key}
    >
      <header className="turn-changes__header">
        <span className="turn-changes__glyph" aria-hidden="true">
          <ExtensionIcon />
        </span>
        <div className="turn-changes__summary">
          <span className="turn-changes__title">{card.title}</span>
          {card.subtitle ? <span className="extension-card__subtitle">{card.subtitle}</span> : null}
        </div>
        {board ? (
          <span className="extension-card__answered" data-testid="extension-card-answered">
            {t("extensionForm.answered")}
          </span>
        ) : null}
        {toneLabel ? <span className="extension-card__tone">{toneLabel}</span> : null}
        {controls}
      </header>
      {!collapsed && board ? <AnsweredBoard board={board} /> : null}
      {hasBody ? (
        <ul className="turn-changes__files">
          {rows.map((row, index) => (
            <li className="extension-card__row" key={`row:${index}`}>
              <span className="extension-card__label">{row.label}</span>
              <span className="extension-card__value">{row.value}</span>
            </li>
          ))}
          {card.actions.map((action, index) => {
            const target = actionTarget(action);
            return (
              <li key={`action:${index}`}>
                <button
                  type="button"
                  className="turn-changes__file extension-card__action"
                  data-action-type={action.type}
                  disabled={!onAction}
                  title={target}
                  onClick={() => onAction?.(action)}
                >
                  <span className="extension-card__label">{action.label}</span>
                  <span className="extension-card__action-target">{target}</span>
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </section>
  );
}

/**
 * The question an answered card keeps: every option stays on screen, the ones the user picked are
 * marked, and the rest are muted. This is the board the user saw while answering, so the thread
 * shows what they chose from — not only what they chose.
 */
function AnsweredBoard({ board }: { readonly board: ExtensionCardAnsweredForm }) {
  const { t } = useTranslation();
  return (
    <div className="extension-card__board" data-testid="extension-card-board">
      {board.fields.map((field) => {
        const answers = answersFor(board, field);
        return (
          <div className="extension-card__board-field" key={field.id}>
            <div className="extension-card__board-title">{field.title}</div>
            {field.description ? (
              <p className="extension-card__board-description">{field.description}</p>
            ) : null}
            {field.kind === "text" ? (
              <p className="extension-card__board-answer" data-testid="extension-card-board-note">
                {answers.join("、") || "—"}
              </p>
            ) : (
              <ul className="extension-card__board-options">
                {(field.options ?? []).map((option) => {
                  const picked = answers.includes(option.value);
                  return (
                    <li
                      className={`extension-card__board-option ${
                        picked ? "extension-card__board-option--picked" : ""
                      }`}
                      data-picked={picked ? "true" : "false"}
                      key={option.value}
                    >
                      <span className="extension-card__board-mark" aria-hidden="true">
                        {picked ? "●" : ""}
                      </span>
                      <span className="extension-card__board-option-body">
                        <span className="extension-card__board-option-title">
                          {option.label}
                          {option.recommended ? (
                            <span className="extension-card__board-badge">
                              {t("extensionDialog.recommended")}
                            </span>
                          ) : null}
                        </span>
                        {option.description ? (
                          <span className="extension-card__board-option-description">
                            {option.description}
                          </span>
                        ) : null}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** The answers one field got, as a list: a multi answer is one entry per picked option. */
function answersFor(board: ExtensionCardAnsweredForm, field: HostUiFormField): readonly string[] {
  const answer = board.values[field.id];
  if (answer === undefined) return [];
  if (typeof answer === "string") return [answer];
  return answer.filter((entry): entry is string => typeof entry === "string");
}

/** What a button will touch, shown beside its label so the user knows before clicking. */
function actionTarget(action: ExtensionAction): string {
  switch (action.type) {
    case "openFile":
      return action.line ? `${action.path}:${action.line}` : action.path;
    case "composer":
      return "Adds to message";
    case "url":
      return new URL(action.url).host;
    case "command":
      return action.command;
    case "openThread":
      return "Opens thread";
    default:
      return unhandledAction(action);
  }
}

function unhandledAction(action: never): string {
  return (action as ExtensionAction).label;
}

function cardToneLabel(tone: ExtensionCardTone): string | undefined {
  switch (tone) {
    case "success":
      return "Passed";
    case "warning":
      return "Warning";
    case "error":
      return "Failed";
    case "neutral":
      return undefined;
  }
}
