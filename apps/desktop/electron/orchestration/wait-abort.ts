/**
 * A sleep that a cancelled run can cut short.
 *
 * A blocking wait is the one place where the user's Stop has to reach into a tool: without this,
 * the turn would sit behind a two-second timer until the deadline and only then notice it was
 * cancelled. Exported so the behaviour can be tested without a whole session.
 */
export function delayOrAbort(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    const finish = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", finish);
      resolve();
    };
    const timer = setTimeout(finish, Math.max(0, ms));
    signal?.addEventListener("abort", finish, { once: true });
  });
}
