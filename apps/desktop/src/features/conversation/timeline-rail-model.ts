import type { DisplayTimelineItem } from "../../../contracts/timeline-types";
import { parseCrossProjectMessage } from "../../../contracts/thread-message";
import { parseAnnotatedPrompt } from "./annotations/annotation-prompt";
import type { TimelineRow } from "./timeline-layout";

/**
 * One tick on the transcript rail: where a prompt the user sent sits in the whole thread, so a
 * long conversation can be scanned without wheel-scrolling through it. Derived from the same
 * committed row layout the viewport scrolls by, never from rendered rows, so ticks exist for
 * prompts that are far outside the mounted window.
 */
export interface TimelineRailTick {
  /** The transcript row this tick jumps to. */
  readonly rowId: string;
  /** 1-based position among this thread's prompts. */
  readonly index: number;
  /** The row's start as a fraction (0..1) of the thread's total height. */
  readonly fraction: number;
  /** One-line excerpt of what the user sent, for the hover preview. */
  readonly preview: string;
  /** The prompt the viewport is currently reading, so the rail can mark one position. */
  readonly active: boolean;
}

/** Fewer prompts than this is still one screen: a rail would only add chrome. */
export const TIMELINE_RAIL_MIN_TICKS = 2;
const PREVIEW_MAX_CHARS = 160;

export function hasTimelineRail(ticks: readonly TimelineRailTick[]): boolean {
  return ticks.length >= TIMELINE_RAIL_MIN_TICKS;
}

/**
 * Ticks for the prompts in thread order: the last one at or above the reading position is the
 * prompt being read. `scrollTop` tolerates a few pixels so a jump that lands exactly on a row's
 * top selects that row. `atBottom` wins over that comparison: the tail of a virtualized thread is
 * still measured from estimates, so its last row's top can sit below the real maximum scroll.
 */
export function buildRailTicks(
  rows: readonly TimelineRow[],
  totalHeight: number,
  scrollTop: number,
  atBottom = false,
): readonly TimelineRailTick[] {
  const prompts = rows.filter(isUserPrompt);
  const extent = Math.max(1, totalHeight);
  let activeId: string | null = null;
  for (const row of prompts) if (row.top <= scrollTop + 12) activeId = row.item.id;
  if (atBottom) activeId = prompts.at(-1)?.item.id ?? null;
  return prompts.map((row, position) => ({
    rowId: row.item.id,
    index: position + 1,
    fraction: Math.min(1, Math.max(0, row.top / extent)),
    preview: previewText(row.item),
    active: row.item.id === activeId,
  }));
}

function isUserPrompt(row: TimelineRow): row is TimelineRow & {
  readonly item: Extract<DisplayTimelineItem, { kind: "message" }>;
} {
  return row.item.kind === "message" && row.item.role === "user";
}

/**
 * The prompt as the user would recognize it: cross-project headers and annotation blocks are
 * wrapper syntax, so the excerpt starts at the body they were attached to.
 */
export function previewText(item: DisplayTimelineItem): string {
  if (item.kind !== "message") return "";
  const crossProject = parseCrossProjectMessage(item.text);
  const annotated = crossProject ? null : parseAnnotatedPrompt(item.text);
  const firstAnnotation = annotated?.annotations[0];
  const body =
    crossProject?.body ??
    (annotated &&
      (annotated.body.trim() || firstAnnotation?.note.trim() || firstAnnotation?.quote)) ??
    item.text;
  const collapsed = body.replace(/\s+/g, " ").trim();
  if (collapsed) {
    return collapsed.length > PREVIEW_MAX_CHARS
      ? `${collapsed.slice(0, PREVIEW_MAX_CHARS).trimEnd()}…`
      : collapsed;
  }
  const attachments = item.attachments ?? [];
  if (attachments.length === 1) {
    const attachment = attachments[0]!;
    return attachment.kind === "image" ? "Image attachment" : attachment.name;
  }
  if (attachments.length > 1) return `${attachments.length} attachments`;
  return "Empty message";
}
