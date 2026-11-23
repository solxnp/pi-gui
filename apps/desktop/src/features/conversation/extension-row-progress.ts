import type { ExtensionCardRow } from "@pi-gui/session-driver";

/**
 * Whether a row draws its own bar. Shared by the renderer and by the timeline's height model, so
 * the two cannot disagree about how tall a card is.
 *
 * Only a step that is actually moving gets a bar. Done is a finished tick, and pending, blocked
 * are both standing still: a bar under any of them would read as progress that is not happening.
 * A row without a status is a plain card row, not a plan step, so a fraction the writer gave it
 * still draws.
 */
export function showsRowProgress(row: Pick<ExtensionCardRow, "status" | "progress">): boolean {
  if (row.progress === undefined) return false;
  return row.status === undefined || row.status === "in_progress";
}

/** The extra height one row's bar adds, so the virtual timeline does not jump when it appears. */
export const ROW_PROGRESS_HEIGHT = 16;
