/**
 * Clock times on the transcript, taken from the session's own message timestamps — no model
 * call, and no extra state: a long silent run still shows when each row arrived.
 *
 * The format is a local 24-hour `HH:MM`. Seconds would make a wall of rows noisier than
 * useful, and a fixed `HH:MM` reads the same in every locale.
 */
export function clockTime(createdAt: string): string | undefined {
  const ms = Date.parse(createdAt);
  if (Number.isNaN(ms)) {
    return undefined;
  }
  const date = new Date(ms);
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

/** The tooltip for a clock time: the full local date and time, for when the day matters. */
export function clockTimeTitle(createdAt: string): string | undefined {
  const ms = Date.parse(createdAt);
  if (Number.isNaN(ms)) {
    return undefined;
  }
  return new Date(ms).toLocaleString();
}
