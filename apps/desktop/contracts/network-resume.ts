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
 */

export const networkResumeMaxAttemptOptions = [3, 5, 10, 0] as const;

/** Automatic "continue" messages per thread; 0 means keep trying until it works. */
export type NetworkResumeMaxAttempts = (typeof networkResumeMaxAttemptOptions)[number];

export interface NetworkResumePreferences {
  readonly enabled: boolean;
  readonly maxAttempts: NetworkResumeMaxAttempts;
}

export interface NetworkResumePreferencesPatch {
  readonly enabled?: boolean;
  readonly maxAttempts?: number;
}

/** A thread waiting for the network; shown in Settings so the resume is not invisible. */
export interface NetworkResumeWaitingRecord {
  readonly workspaceId: string;
  readonly sessionId: string;
  /** When the network failure was seen. */
  readonly since: string;
  /** How many "continue" messages this watcher already sent to the thread. */
  readonly attempts: number;
  readonly errorMessage: string;
  /** The thread's title, filled in by the app store for the Settings list. */
  readonly title?: string;
  /** The cap stopped the loop; the thread now waits for the person. */
  readonly exhausted?: boolean;
}

export const defaultNetworkResumePreferences: NetworkResumePreferences = {
  enabled: true,
  maxAttempts: 5,
};

export function isNetworkResumeMaxAttempts(value: unknown): value is NetworkResumeMaxAttempts {
  return (
    typeof value === "number" &&
    networkResumeMaxAttemptOptions.includes(value as NetworkResumeMaxAttempts)
  );
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
  };
}
