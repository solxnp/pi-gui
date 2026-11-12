/*
 * Automatic resume after a network outage.
 *
 * A run that died while the machine could not reach the outside world leaves a thread sitting
 * there: the model never finished, and the person has to type "continue" the next morning. This
 * setting lets pi-gui watch for that case, probe the network from the background and, once it is
 * back, deliver that "continue" itself.
 *
 * Only network failures qualify. A 401, a context overflow or a stopped run is not retried: those
 * need a person, and retrying them would repeat the same failure all night.
 *
 * The timing knobs are settings, not constants: how often to probe, how many clean probes count as
 * "the network is back", and when to stop waiting. Changing one takes effect on the next probe
 * instead of after a restart.
 */

export const networkResumeMaxAttemptOptions = [3, 5, 10, 0] as const;
/** Automatic "continue" messages per thread; 0 means keep trying until it works. */
export type NetworkResumeMaxAttempts = (typeof networkResumeMaxAttemptOptions)[number];

/** Gap between background probes; also the timeout of one probe is a fraction of it. */
export const networkResumeIntervalOptions = [15_000, 30_000, 60_000, 120_000] as const;
export type NetworkResumeIntervalMs = (typeof networkResumeIntervalOptions)[number];

/** Clean probes in a row before a thread is resumed: a stable link, not a blip. */
export const networkResumeSuccessOptions = [1, 2, 5, 10] as const;
export type NetworkResumeSuccesses = (typeof networkResumeSuccessOptions)[number];

/** Failed probes in a row before a thread is dropped from the list; 0 waits all night. */
export const networkResumeGiveUpOptions = [10, 20, 60, 0] as const;
export type NetworkResumeGiveUpAfter = (typeof networkResumeGiveUpOptions)[number];

export interface NetworkResumePreferences {
  readonly enabled: boolean;
  readonly maxAttempts: NetworkResumeMaxAttempts;
  readonly probeIntervalMs: NetworkResumeIntervalMs;
  readonly consecutiveSuccesses: NetworkResumeSuccesses;
  readonly giveUpAfterFailedProbes: NetworkResumeGiveUpAfter;
}

export interface NetworkResumePreferencesPatch {
  readonly enabled?: boolean;
  readonly maxAttempts?: number;
  readonly probeIntervalMs?: number;
  readonly consecutiveSuccesses?: number;
  readonly giveUpAfterFailedProbes?: number;
}

/** A thread waiting for the network; shown in Settings so the resume is not invisible. */
export interface NetworkResumeWaitingRecord {
  readonly workspaceId: string;
  readonly sessionId: string;
  /** When the network failure was seen. */
  readonly since: string;
  /** How many "continue" messages this watcher already sent to the thread. */
  readonly attempts: number;
  /** Failed probes in a row so far; the person can see the watcher give up on it. */
  readonly failedProbes?: number;
  readonly errorMessage: string;
  /** The thread's title, filled in by the app store for the Settings list. */
  readonly title?: string;
  /** The cap stopped the loop; the thread now waits for the person. */
  readonly exhausted?: boolean;
}

export const defaultNetworkResumePreferences: NetworkResumePreferences = {
  enabled: true,
  maxAttempts: 5,
  probeIntervalMs: 60_000,
  consecutiveSuccesses: 10,
  giveUpAfterFailedProbes: 10,
};

export function isNetworkResumeMaxAttempts(value: unknown): value is NetworkResumeMaxAttempts {
  return typeof value === "number" && networkResumeMaxAttemptOptions.includes(value as never);
}

export function isNetworkResumeIntervalMs(value: unknown): value is NetworkResumeIntervalMs {
  return typeof value === "number" && networkResumeIntervalOptions.includes(value as never);
}

export function isNetworkResumeSuccesses(value: unknown): value is NetworkResumeSuccesses {
  return typeof value === "number" && networkResumeSuccessOptions.includes(value as never);
}

export function isNetworkResumeGiveUpAfter(value: unknown): value is NetworkResumeGiveUpAfter {
  return typeof value === "number" && networkResumeGiveUpOptions.includes(value as never);
}

/** Applies a Settings patch; anything unrecognised is ignored rather than guessed at. */
export function applyNetworkResumePreferencesPatch(
  current: NetworkResumePreferences,
  patch: NetworkResumePreferencesPatch,
): NetworkResumePreferences {
  return {
    enabled: typeof patch.enabled === "boolean" ? patch.enabled : current.enabled,
    maxAttempts: isNetworkResumeMaxAttempts(patch.maxAttempts)
      ? patch.maxAttempts
      : current.maxAttempts,
    probeIntervalMs: isNetworkResumeIntervalMs(patch.probeIntervalMs)
      ? patch.probeIntervalMs
      : current.probeIntervalMs,
    consecutiveSuccesses: isNetworkResumeSuccesses(patch.consecutiveSuccesses)
      ? patch.consecutiveSuccesses
      : current.consecutiveSuccesses,
    giveUpAfterFailedProbes: isNetworkResumeGiveUpAfter(patch.giveUpAfterFailedProbes)
      ? patch.giveUpAfterFailedProbes
      : current.giveUpAfterFailedProbes,
  };
}
