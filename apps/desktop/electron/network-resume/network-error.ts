/*
 * Which run failures are network failures.
 *
 * The rule set is a message match, not an error-code match: pi reports every failed run as
 * `SEND_FAILED`, so the only signal is the error text the provider client produced
 * (`fetch failed`, `ECONNRESET`, `socket hang up`, `Connection error.` …).
 *
 * The list is deliberately narrow. A retried 401, a context overflow or a stopped run would fail
 * the same way all night, so anything that is not clearly a connection problem stays out.
 */

/** Things that mean "the request never reached a working server", not "the server said no". */
const NETWORK_ERROR_PATTERNS: readonly RegExp[] = [
  /fetch failed/i,
  /\bECONNRESET\b/,
  /\bECONNREFUSED\b/,
  /\bECONNABORTED\b/,
  /\bENOTFOUND\b/,
  /\bEAI_AGAIN\b/,
  /\bETIMEDOUT\b/,
  /\bEHOSTUNREACH\b/,
  /\bENETUNREACH\b/,
  /\bEPIPE\b/,
  /\bUND_ERR_[A-Z_]+\b/,
  /socket hang up/i,
  /getaddrinfo/i,
  /network is unreachable/i,
  /network error/i,
  /connection error/i,
  /connection reset/i,
  /connection refused/i,
  /connection timed out/i,
  /stream (?:ended|closed) prematurely/i,
  /other side closed/i,
  /internet connection (?:appears to be )?(?:offline|unreachable)/i,
];

/**
 * Failures that carry a network-looking word but are not worth retrying.
 *
 * A user stop, a cancelled request and a context overflow can all surface with text that the
 * patterns above would otherwise catch.
 */
const NOT_NETWORK_PATTERNS: readonly RegExp[] = [
  /aborterror/i,
  /aborted/i,
  /\b401\b/,
  /\b403\b/,
  /\b429\b/,
  /invalid api key/i,
  /context (?:length|window)/i,
  /rate limit/i,
  /quota/i,
  /insufficient/i,
];

export function isNetworkErrorMessage(message: string | undefined): boolean {
  const text = (message ?? "").trim();
  if (text.length === 0) {
    return false;
  }
  if (NOT_NETWORK_PATTERNS.some((pattern) => pattern.test(text))) {
    return false;
  }
  return NETWORK_ERROR_PATTERNS.some((pattern) => pattern.test(text));
}
