/**
 * How stale a pinned card is.
 *
 * A pinned card only changes when its writer writes it again, so a card can sit at "0%" for ten
 * minutes while the run is busy — the numbers are true, but they are not live. Measuring the
 * card's own age is the only honest signal the app can produce without the writer's cooperation,
 * and it is the one the user needs: "is this card still describing what is happening?".
 */
export const PIN_STALE_AFTER_MS = 3 * 60_000;

export interface PinFreshness {
  /** Whole minutes since the card was last written. */
  readonly minutes: number;
  /** True once the card is old enough that it probably no longer tracks the run. */
  readonly stale: boolean;
}

export function describePinFreshness(
  createdAt: string,
  now: number,
  staleAfterMs: number = PIN_STALE_AFTER_MS,
): PinFreshness {
  const written = Date.parse(createdAt);
  // A card with an unparseable timestamp is treated as ancient: better a warning than a lie.
  const age = Number.isFinite(written) ? Math.max(0, now - written) : Number.POSITIVE_INFINITY;
  return {
    minutes: Number.isFinite(age) ? Math.floor(age / 60_000) : Number.POSITIVE_INFINITY,
    stale: age >= staleAfterMs,
  };
}

/**
 * Whether the card should be flagged as possibly out of date.
 *
 * Only while a run is going: a card that is old because the work finished is not stale, it is
 * simply done, and warning about it would train the user to ignore the warning.
 */
export function shouldWarnStale(
  createdAt: string,
  now: number,
  running: boolean,
  staleAfterMs: number = PIN_STALE_AFTER_MS,
): boolean {
  return running && describePinFreshness(createdAt, now, staleAfterMs).stale;
}

/**
 * What the run is doing, as the transcript already records it. Nothing here depends on the plan
 * card's writer.
 *
 * `live` is the difference that matters: a tool call still in flight is what the run is doing
 * right now, while the newest finished call may be minutes old — calling that "running" would be
 * exactly the false reassurance this feature exists to remove.
 */
export interface CurrentActivity {
  readonly label: string;
  readonly live: boolean;
}

export function currentActivity(
  rows: readonly { readonly kind: string; readonly status?: string; readonly label?: string }[],
): CurrentActivity | undefined {
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const row = rows[index];
    if (!row || row.kind !== "tool") continue;
    if (row.status === "running") {
      return row.label ? { label: row.label, live: true } : undefined;
    }
  }
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const row = rows[index];
    if (!row || row.kind !== "tool") continue;
    return row.label ? { label: row.label, live: false } : undefined;
  }
  return undefined;
}
