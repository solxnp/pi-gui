/*
 * Watches for runs that died because the machine lost the network, and finishes the job of typing
 * "continue" once it comes back.
 *
 * The loop is intentionally boring:
 *   1. a run fails with a network message -> the thread joins the waiting list;
 *   2. every minute (only while something is waiting) a HEAD request asks whether the outside
 *      world answers; two successes in a row count as "back", so a flapping link does not restart
 *      half the threads;
 *   3. each waiting thread gets one "continue" message, delivered the same way a scheduled task
 *      delivers its instruction, so it lands in the transcript like anything else;
 *   4. a thread that is running, archived or gone leaves the list; a cap stops a thread that keeps
 *      failing so one bad night cannot burn a budget.
 *
 * State is in memory on purpose: the failure text it is based on is in memory too (pi does not
 * record it), so after a restart there is nothing trustworthy to resume.
 */

import type { SessionDriverEvent, SessionRef } from "@pi-gui/session-driver";
import type {
  NetworkResumePreferences,
  NetworkResumeWaitingRecord,
} from "../../contracts/network-resume";
import { isNetworkErrorMessage } from "./network-error";
import type { NetworkResumeLog } from "./network-resume-log";
import type { NetworkProbe } from "./network-probe";

/** One probe per minute, as asked: often enough to feel immediate, cheap enough to run all night. */
export const DEFAULT_NETWORK_RESUME_INTERVAL_MS = 60_000;
/** Two clear answers before resuming, so a one-off blip does not restart every thread. */
export const DEFAULT_NETWORK_RESUME_SUCCESSES = 2;
/** Give up after this many failed deliveries in a row for one thread. */
const MAX_DELIVERY_FAILURES = 3;

const CONTINUE_MESSAGE = "继续";

export interface NetworkResumeSessionState {
  readonly status: "idle" | "running" | "failed";
  readonly archivedAt?: string;
}

export interface NetworkResumeHost {
  readonly getPreferences: () => NetworkResumePreferences;
  readonly sessionState: (ref: SessionRef) => NetworkResumeSessionState | undefined;
  /** Sends `text` into the thread the way a background instruction is delivered. */
  readonly deliverContinue: (ref: SessionRef, text: string) => Promise<void>;
  /** Hands the current waiting list to the app state so Settings can show it. */
  readonly publish: (waiting: readonly NetworkResumeWaitingRecord[]) => void;
  /** One line per decision, so a thread that never resumed can be explained later. */
  readonly log?: NetworkResumeLog;
}

export interface NetworkResumeServiceOptions {
  readonly probe: NetworkProbe;
  readonly intervalMs?: number;
  readonly successesRequired?: number;
  readonly now?: () => number;
}

interface WaitingEntry {
  readonly workspaceId: string;
  readonly sessionId: string;
  readonly since: string;
  attempts: number;
  deliveryFailures: number;
  errorMessage: string;
  exhausted: boolean;
}

function refKey(ref: SessionRef): string {
  return `${ref.workspaceId}:${ref.sessionId}`;
}

export class NetworkResumeService {
  private readonly waiting = new Map<string, WaitingEntry>();
  private readonly intervalMs: number;
  private readonly successesRequired: number;
  private readonly now: () => number;
  private timer: NodeJS.Timeout | undefined;
  private probeStreak = 0;
  private ticking = false;
  private stopped = false;

  constructor(
    private readonly host: NetworkResumeHost,
    private readonly options: NetworkResumeServiceOptions,
  ) {
    this.intervalMs = options.intervalMs ?? DEFAULT_NETWORK_RESUME_INTERVAL_MS;
    this.successesRequired = options.successesRequired ?? DEFAULT_NETWORK_RESUME_SUCCESSES;
    this.now = options.now ?? (() => Date.now());
  }

  /** Returns the stop function; call it when the app quits. */
  start(): () => void {
    this.stopped = false;
    this.schedule();
    return () => {
      this.stopped = true;
      if (this.timer) {
        clearTimeout(this.timer);
        this.timer = undefined;
      }
    };
  }

  listWaiting(): readonly NetworkResumeWaitingRecord[] {
    return [...this.waiting.values()].map((entry) => ({
      workspaceId: entry.workspaceId,
      sessionId: entry.sessionId,
      since: entry.since,
      attempts: entry.attempts,
      errorMessage: entry.errorMessage,
      ...(entry.exhausted ? { exhausted: true } : {}),
    }));
  }

  /** Fed by the store's session-event stream; everything else is ignored. */
  handleEvent(event: SessionDriverEvent): void {
    switch (event.type) {
      case "runFailed": {
        this.noteFailure(event.sessionRef, event.error.message);
        return;
      }
      case "sessionOpened":
      case "sessionUpdated":
      case "runCompleted": {
        if (event.snapshot.status === "running") {
          this.forget(event.sessionRef, "running");
        }
        return;
      }
      case "sessionClosed": {
        this.forget(event.sessionRef, "closed");
        return;
      }
      default:
        return;
    }
  }

  /** Runs one probe now instead of waiting for the timer; specs drive the loop with this. */
  async probeNow(): Promise<void> {
    await this.tick();
  }

  /** Settings changed: a switched-off watcher drops what it was holding. */
  preferencesChanged(): void {
    const { enabled, maxAttempts } = this.host.getPreferences();
    this.note("preferences", { enabled, maxAttempts });
    if (!enabled && this.waiting.size > 0) {
      this.waiting.clear();
      this.publish();
      this.stopTimer();
    }
    this.probeStreak = 0;
    this.schedule();
  }

  private noteFailure(ref: SessionRef, message: string): void {
    const network = isNetworkErrorMessage(message);
    this.note("failure", {
      thread: refKey(ref),
      network,
      enabled: this.host.getPreferences().enabled,
      message,
    });
    if (!this.host.getPreferences().enabled || !network) {
      // A newer failure that is not about the network means this thread no longer waits for it.
      this.forget(ref, "not-network");
      return;
    }
    const key = refKey(ref);
    const existing = this.waiting.get(key);
    this.waiting.set(key, {
      workspaceId: ref.workspaceId,
      sessionId: ref.sessionId,
      since: existing?.since ?? new Date(this.now()).toISOString(),
      // A person typing again after the cap was hit gets a fresh budget.
      attempts: existing?.exhausted ? 0 : (existing?.attempts ?? 0),
      deliveryFailures: existing?.exhausted ? 0 : (existing?.deliveryFailures ?? 0),
      errorMessage: message,
      exhausted: false,
    });
    this.publish();
    this.probeStreak = 0;
    this.schedule();
  }

  private forget(ref: SessionRef, reason: string): void {
    if (this.waiting.delete(refKey(ref))) {
      this.note("drop", { thread: refKey(ref), reason });
      this.publish();
    }
    this.schedule();
  }

  private publish(): void {
    this.host.publish(this.listWaiting());
  }

  /** Never throws: the watcher must keep working on a machine that cannot write a log. */
  private note(event: string, fields: Record<string, string | number | boolean>): void {
    const log = this.host.log;
    if (!log) {
      return;
    }
    try {
      const pairs = Object.entries(fields)
        .map(([key, value]) => `${key}=${formatLogValue(value)}`)
        .join(" ");
      log(`${new Date(this.now()).toISOString()} ${event}${pairs ? ` ${pairs}` : ""}`);
    } catch {
      // A logger that throws is worse than no logger.
    }
  }

  private stopTimer(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
  }

  /** One timer at a time, and only while a thread is actually waiting. */
  private schedule(): void {
    if (this.stopped || this.timer || this.waiting.size === 0) {
      return;
    }
    if (!this.host.getPreferences().enabled) {
      return;
    }
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.tick()
        .catch((error: unknown) => {
          console.warn(
            "[network-resume] probe cycle failed:",
            error instanceof Error ? error.message : error,
          );
        })
        .then(
          () => this.schedule(),
          () => this.schedule(),
        );
    }, this.intervalMs);
    // Node keeps the process alive for a pending timer; this one must not hold the app open.
    this.timer.unref?.();
  }

  private async tick(): Promise<void> {
    if (this.ticking || this.stopped) {
      return;
    }
    this.ticking = true;
    try {
      if (!this.host.getPreferences().enabled || this.waiting.size === 0) {
        return;
      }
      const result = await this.options.probe();
      this.note("probe", {
        result,
        streak: result === "reachable" ? this.probeStreak + 1 : 0,
        needed: this.successesRequired,
        waiting: this.waiting.size,
      });
      if (result !== "reachable") {
        this.probeStreak = 0;
        return;
      }
      this.probeStreak += 1;
      if (this.probeStreak < this.successesRequired) {
        return;
      }
      await this.resumeWaiting();
    } finally {
      this.ticking = false;
    }
  }

  private async resumeWaiting(): Promise<void> {
    for (const entry of [...this.waiting.values()]) {
      if (this.stopped || !this.host.getPreferences().enabled) {
        return;
      }
      await this.resume(entry);
    }
  }

  private async resume(entry: WaitingEntry): Promise<void> {
    const ref: SessionRef = { workspaceId: entry.workspaceId, sessionId: entry.sessionId };
    const state = this.host.sessionState(ref);
    if (!state || state.archivedAt) {
      this.note("drop", {
        thread: refKey(ref),
        reason: state ? "archived" : "missing",
      });
      this.waiting.delete(refKey(ref));
      this.publish();
      return;
    }
    if (state.status === "running") {
      this.note("skip", { thread: refKey(ref), reason: "running", attempts: entry.attempts });
      return;
    }
    const { maxAttempts } = this.host.getPreferences();
    if (entry.exhausted) {
      return;
    }
    if (maxAttempts > 0 && entry.attempts >= maxAttempts) {
      entry.exhausted = true;
      this.note("exhausted", { thread: refKey(ref), attempts: entry.attempts, maxAttempts });
      this.publish();
      return;
    }

    entry.attempts += 1;
    this.note("continue", { thread: refKey(ref), attempt: entry.attempts, maxAttempts });
    try {
      await this.host.deliverContinue(ref, CONTINUE_MESSAGE);
      entry.deliveryFailures = 0;
      this.publish();
    } catch (error) {
      entry.deliveryFailures += 1;
      const message = error instanceof Error ? error.message : String(error);
      this.note("continue-failed", {
        thread: refKey(ref),
        error: message,
        failures: entry.deliveryFailures,
      });
      console.warn(
        `[network-resume] could not deliver "continue" to ${refKey(ref)}:`,
        error instanceof Error ? error.message : error,
      );
      if (entry.deliveryFailures >= MAX_DELIVERY_FAILURES) {
        entry.exhausted = true;
      }
      this.publish();
    }
  }
}

/** Keeps one log line readable: spaces and quotes would blur the `key=value` pairs. */
function formatLogValue(value: string | number | boolean): string {
  const text = typeof value === "string" ? value.replace(/\s+/g, " ").trim() : String(value);
  const clipped = text.length > 160 ? `${text.slice(0, 159)}…` : text;
  return /[\s"]/.test(clipped) ? `"${clipped.replace(/"/g, "'")}"` : clipped || '""';
}
