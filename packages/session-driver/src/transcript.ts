import type { ExtensionAction } from "./extension-actions.js";
import type { HostUiFormField } from "./types.js";

export interface SessionTranscriptImageAttachment {
  readonly kind: "image";
  readonly mimeType: string;
  readonly data: string;
  readonly name?: string;
}

export interface SessionTranscriptFileAttachment {
  readonly kind: "file";
  readonly name: string;
  readonly mimeType: string;
  readonly fsPath: string;
  readonly sizeBytes?: number;
}

export type SessionTranscriptAttachment =
  SessionTranscriptImageAttachment | SessionTranscriptFileAttachment;

export type SessionTranscriptRole = "user" | "assistant" | "branchSummary" | "compactionSummary";

export interface SessionTranscriptMessage {
  readonly kind: "message";
  readonly role: SessionTranscriptRole;
  readonly text: string;
  readonly attachments?: readonly SessionTranscriptAttachment[];
  readonly createdAt: string;
  readonly id: string;
  /** Authoritative persisted entry identity; a live display row can retain its own id. */
  readonly sourceMessageId?: string;
}

export interface SessionTranscriptToolCall {
  readonly kind: "tool";
  readonly id: string;
  readonly callId: string;
  readonly toolName: string;
  /** "error" also covers calls whose result never arrived (interrupted runs). */
  readonly status: "success" | "error";
  readonly input?: unknown;
  readonly output?: unknown;
  readonly createdAt: string;
}

/**
 * An extension's `pi.sendMessage({ customType, content, display: true })`, drawn the way
 * terminal pi draws it: the customType as a label over the markdown text.
 */
export interface SessionTranscriptCustomMessage {
  readonly kind: "custom";
  /** The pi session entry id, so live and reloaded rows share one identity. */
  readonly id: string;
  readonly createdAt: string;
  readonly customType: string;
  /** Markdown from the message's text parts. */
  readonly text: string;
}

/** The custom entry type an extension writes with `pi.appendEntry` to show a card in pi-gui. */
export const EXTENSION_CARD_CUSTOM_TYPE = "pi-gui.card";

export type ExtensionCardTone = "neutral" | "success" | "warning" | "error";

export interface ExtensionCardRow {
  readonly label: string;
  readonly value: string;
  /**
   * Progress a plan row reports. A renderer that knows it draws a status icon and drops the
   * label; one that does not still has `label` and `value` to fall back on.
   */
  readonly status?: ExtensionCardRowStatus;
  /**
   * How far through this row's own work it is, 0 to 1, as the writer judged it. A renderer that
   * knows it draws a thin bar under the row, so one long step's partial progress is visible
   * without a second tool call.
   */
  readonly progress?: number;
  /**
   * How long the writer expects this row to take, in minutes. Shown as an estimate: with the
   * card's own age beside it, an overrun becomes visible instead of invisible.
   */
  readonly etaMinutes?: number;
}

/** The four states a step can be in. Anything else is drawn as unmarked. */
export type ExtensionCardRowStatus = "pending" | "in_progress" | "done" | "blocked";

/**
 * A 0..1 fraction, clamped; anything that is not a finite number is no progress at all.
 *
 * One implementation, because three places need it: the driver parsing a card entry, the plan
 * tool building one, and the renderer guarding a card built by hand. Two copies drifted apart
 * once already (the renderer could print `NaN%` while the parser had dropped the value).
 */
/** A day is plenty; a larger estimate is a typo, not a plan. */
export const MAX_ETA_MINUTES = 24 * 60;

/**
 * Whole minutes for an estimate, or nothing. One implementation: the plan tool and the entry
 * parser both write this field, and two copies of the rule drifted apart once already.
 */
export function clampEtaMinutes(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  if (value > MAX_ETA_MINUTES) return undefined;
  const minutes = Math.round(value);
  // Anything that rounds to 0 is not a usable estimate, and returning 0 would let the writer save
  // a value the reader then silently drops: one rule, applied on both sides.
  return minutes >= 1 ? minutes : undefined;
}

export function clampUnitInterval(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  return Math.min(1, Math.max(0, value));
}

/**
 * A card an extension declares as data with `pi.appendEntry("pi-gui.card", card)`.
 * pi-gui draws it with its own component; there are no styling knobs.
 */
export interface ExtensionCard {
  /**
   * Writing another card with the same key updates this one where it first appeared,
   * instead of adding a new row.
   */
  readonly key?: string;
  readonly title: string;
  readonly subtitle?: string;
  readonly tone: ExtensionCardTone;
  readonly rows: readonly ExtensionCardRow[];
  readonly actions: readonly ExtensionAction[];
  /**
   * How far through the card's work it is, 0 to 1. Drawn as a bar and a percentage; a card that
   * omits it gets no bar, which keeps answered forms and one-off notices unchanged.
   */
  readonly progress?: number;
  /**
   * A question that was asked and answered, with its question and every option kept: the thread
   * shows the whole board afterwards, with the chosen options marked. `rows` still carries the
   * answer lines, so a client that does not know this field shows the summary instead.
   */
  readonly answeredForm?: ExtensionCardAnsweredForm;
}

/** A `form` request plus the answers it got, as the transcript keeps them. */
export interface ExtensionCardAnsweredForm {
  readonly fields: readonly HostUiFormField[];
  readonly values: Readonly<Record<string, string | readonly string[]>>;
  readonly allowOther?: boolean;
  /** The user skipped the question instead of answering it, so nothing is marked as picked. */
  readonly skipped?: boolean;
}

export interface SessionTranscriptCard {
  readonly kind: "card";
  /**
   * `card:<key>` for a keyed card, else the pi entry id, so the live row and the reopened
   * row are the same item.
   */
  readonly id: string;
  readonly createdAt: string;
  readonly card: ExtensionCard;
}

/**
 * The custom entry type an extension writes with `pi.appendEntry` to pin a card above the
 * composer: the card fields with a required key, or `{ key, remove: true }` to unpin it.
 */
export const EXTENSION_PIN_CUSTOM_TYPE = "pi-gui.pin";

/**
 * The latest write of one pinned card on the active branch. Pins are reduced over the whole
 * branch, not the compaction range, so a pin outlives the turns it was written in. Its place in
 * the transcript means nothing: the app draws pins above the composer, never in the timeline.
 */
export interface SessionTranscriptPin {
  readonly kind: "pin";
  /** `pin:<key>`, so each write replaces the one before. */
  readonly id: string;
  /** The latest write's time, so a write after the user hid the pin shows it again. */
  readonly createdAt: string;
  /** Null once the extension removed it, so the live update can replace it in place. */
  readonly card: ExtensionCard | null;
}

export type SessionTranscriptItem =
  | SessionTranscriptMessage
  | SessionTranscriptToolCall
  | SessionTranscriptCustomMessage
  | SessionTranscriptCard
  | SessionTranscriptPin;

/**
 * A card, or the row that says why a `pi-gui.card` or `pi-gui.pin` entry could not be drawn.
 * These sit in the transcript where their entry is in the session file.
 */
export function isCardEntryItem(item: SessionTranscriptItem): boolean {
  return (
    item.kind === "card" ||
    (item.kind === "custom" &&
      (item.customType === EXTENSION_CARD_CUSTOM_TYPE ||
        item.customType === EXTENSION_PIN_CUSTOM_TYPE))
  );
}
