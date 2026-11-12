/*
 * Which run failures are network failures.
 *
 * The rule set is a message match, not an error-code match: pi reports every failed run as
 * `SEND_FAILED`, so the only signal is the error text the provider client produced
 * (`fetch failed`, `ECONNRESET`, `socket hang up`, `Connection error.` …).
 *
 * The list follows the transport half of pi's own retry classifier
 * (`@earendil-works/pi-ai` `RETRYABLE_PROVIDER_ERROR_PATTERN`), because that is the set pi has
 * already judged worth retrying. Two entries matter most in practice and were missing before:
 * undici's bare `terminated` (a stream that died mid-body) and `Request timed out.`. Together
 * they were ~15% of one day's real failures, and every thread that ended on one of them sat
 * still until a person typed "continue".
 *
 * The list is deliberately narrow on the other end: a retried 401, a context overflow or a
 * stopped run would fail the same way all night, so anything the server itself said stays out.
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
  /connection lost/i,
  /socket connection was closed/i,
  /stream (?:ended|closed) prematurely/i,
  /other side closed/i,
  /internet connection (?:appears to be )?(?:offline|unreachable)/i,
  // A response body that stopped mid-flight: undici's own error text for it is just
  // "terminated", which is what a flapping link looks like from inside the client.
  /\bterminated\b/i,
  // Streams that ended one event short of a usable reply.
  /\bended without\b/i,
  /stream ended before/i,
  /reset before headers/i,
  /upstream connect/i,
  /\bhttp2 request did not get a response\b/i,
  /pending stream has been canceled/i,
  /websocket[ ._-]?(?:closed|error)/i,
];

/**
 * A request that ran out of time.
 *
 * Checked before the abort rule: Node reports a timed-out fetch as an abort, so
 * "The operation was aborted due to timeout" is the network giving up, while a bare
 * "Run aborted" is the person pressing Stop.
 */
const TIMEOUT_PATTERNS: readonly RegExp[] = [/\btimed?[ _-]?out\b/i, /\btimeout\b/i];

/**
 * Failures that carry a network-looking word but are not worth retrying.
 *
 * A refused key, an exhausted quota and a context overflow all need a person, and retrying
 * them would repeat the same failure until the cap runs out.
 */
const REFUSAL_PATTERNS: readonly RegExp[] = [
  /\b401\b/,
  /\b403\b/,
  /\b429\b/,
  /invalid api key/i,
  /context (?:length|window)/i,
  /rate limit/i,
  /quota/i,
  /insufficient/i,
  /usage limit/i,
];

/** A stop, not an outage. Checked after timeouts, which arrive as aborts too. */
const ABORT_PATTERNS: readonly RegExp[] = [/aborterror/i, /aborted/i];

export function isNetworkErrorMessage(message: string | undefined): boolean {
  const text = (message ?? "").trim();
  if (text.length === 0) {
    return false;
  }
  if (REFUSAL_PATTERNS.some((pattern) => pattern.test(text))) {
    return false;
  }
  if (TIMEOUT_PATTERNS.some((pattern) => pattern.test(text))) {
    return true;
  }
  if (ABORT_PATTERNS.some((pattern) => pattern.test(text))) {
    return false;
  }
  return NETWORK_ERROR_PATTERNS.some((pattern) => pattern.test(text));
}
