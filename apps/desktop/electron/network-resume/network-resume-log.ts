/*
 * The watcher's decision log.
 *
 * Everything the network watcher bases its decisions on lives in memory: the failure text is not
 * recorded by pi, and the waiting list is not persisted. So when a thread did not get its
 * "continue", there was nothing to look at afterwards. One line per decision — classification,
 * probe, delivery, give-up — is enough to answer "why didn't it resume" from a file.
 *
 * Best effort only: a log that cannot be written must never break the watcher.
 */

import { appendFile, mkdir, rename, stat } from "node:fs/promises";
import { dirname } from "node:path";

export type NetworkResumeLog = (line: string) => void;

/** A night's worth of probes is well under this; the cap only stops unbounded growth. */
const MAX_LOG_BYTES = 512 * 1024;

export function createNetworkResumeLog(logPath: string): NetworkResumeLog {
  let pending: Promise<unknown> = Promise.resolve();
  let prepared: Promise<unknown> | undefined;

  const prepareOnce = (): Promise<unknown> => {
    prepared ??= (async () => {
      await mkdir(dirname(logPath), { recursive: true });
      const size = await stat(logPath).then(
        (info) => info.size,
        () => 0,
      );
      // One roll per launch keeps a long-running install from growing without bound.
      if (size > MAX_LOG_BYTES) {
        await rename(logPath, `${logPath}.1`).catch(() => undefined);
      }
    })();
    return prepared;
  };

  // Appends are chained so lines never interleave, and every failure is swallowed.
  return (line) => {
    pending = pending
      .then(prepareOnce)
      .then(() => appendFile(logPath, `${line}\n`, "utf8"))
      .catch(() => undefined);
  };
}
