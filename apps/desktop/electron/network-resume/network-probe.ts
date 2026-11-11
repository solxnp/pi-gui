/*
 * The background reachability check.
 *
 * "Is the network back?" must not cost a model call and must not appear in any transcript, so the
 * probe talks to a plain HTTPS endpoint instead of pi: any HTTP answer below 500 means the machine
 * can reach the outside world again. DNS failures, TLS failures and timeouts all count as "not
 * yet".
 *
 * Several endpoints are tried because one of them being blocked says nothing about the network.
 * A probe succeeds as soon as one answers.
 */

/** Kept small and dependency-free: two well-known endpoints, no API keys, no payload. */
export const DEFAULT_PROBE_URLS: readonly string[] = [
  "https://www.gstatic.com/generate_204",
  "https://api.github.com",
];

export type NetworkProbeResult = "reachable" | "unreachable";

export type NetworkProbe = () => Promise<NetworkProbeResult>;

export function createHttpProbe(
  urls: readonly string[] = DEFAULT_PROBE_URLS,
  timeoutMs = 6_000,
): NetworkProbe {
  const endpoints = urls.length > 0 ? urls : DEFAULT_PROBE_URLS;
  return async () => {
    for (const url of endpoints) {
      try {
        // HEAD keeps it to headers; redirects are not followed so a captive portal is not "up".
        const response = await fetch(url, {
          method: "HEAD",
          redirect: "manual",
          signal: AbortSignal.timeout(timeoutMs),
        });
        if (response.status < 500) {
          return "reachable";
        }
      } catch {
        // Timeout, DNS failure, TLS failure: try the next endpoint.
      }
    }
    return "unreachable";
  };
}
