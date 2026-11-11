import { expect, test } from "@playwright/test";
import type { SessionDriverEvent, SessionRef } from "@pi-gui/session-driver";
import {
  applyNetworkResumePreferencesPatch,
  defaultNetworkResumePreferences,
  isNetworkResumeMaxAttempts,
} from "../../contracts/network-resume";
import { isNetworkErrorMessage } from "../../electron/network-resume/network-error";
import {
  NetworkResumeService,
  type NetworkResumeSessionState,
} from "../../electron/network-resume/network-resume-service";

const ref: SessionRef = { workspaceId: "ws", sessionId: "s1" };

function failure(message: string, target: SessionRef = ref): SessionDriverEvent {
  return {
    type: "runFailed",
    sessionRef: target,
    timestamp: "2026-11-12T00:00:00.000Z",
    error: { message, code: "SEND_FAILED" },
  } as unknown as SessionDriverEvent;
}

function running(target: SessionRef = ref): SessionDriverEvent {
  return {
    type: "sessionUpdated",
    sessionRef: target,
    timestamp: "2026-11-12T00:00:01.000Z",
    snapshot: { ref: target, status: "running" },
  } as unknown as SessionDriverEvent;
}

interface Harness {
  service: NetworkResumeService;
  published: { title?: string; attempts: number; exhausted?: boolean }[][];
  delivered: string[];
  setReachable(value: boolean): void;
  setState(value: NetworkResumeSessionState | undefined): void;
  setPreferences(patch: { enabled?: boolean; maxAttempts?: number }): void;
}

function createHarness(): Harness {
  let reachable = false;
  let state: NetworkResumeSessionState | undefined = { status: "failed" };
  let preferences = { ...defaultNetworkResumePreferences };
  const published: Harness["published"] = [];
  const delivered: string[] = [];
  const service = new NetworkResumeService(
    {
      getPreferences: () => preferences,
      sessionState: () => state,
      deliverContinue: async (_ref, text) => {
        delivered.push(text);
        // Delivering starts the run, which the store then reports.
        state = { status: "running" };
      },
      publish: (waiting) =>
        published.push(waiting.map((record) => ({ ...record, title: undefined }))),
    },
    {
      probe: async () => (reachable ? "reachable" : "unreachable"),
      // The timer never fires in specs; probeNow() drives the loop.
      intervalMs: 60 * 60 * 1000,
      successesRequired: 2,
      now: () => Date.parse("2026-11-12T00:00:00.000Z"),
    },
  );
  service.start();
  return {
    service,
    published,
    delivered,
    setReachable: (value) => {
      reachable = value;
    },
    setState: (value) => {
      state = value;
    },
    setPreferences: (patch) => {
      preferences = applyNetworkResumePreferencesPatch(preferences, patch);
    },
  };
}

test("network failures are told apart from ordinary ones", () => {
  for (const message of [
    "fetch failed",
    "read ECONNRESET",
    "getaddrinfo ENOTFOUND api.example.com",
    "connect ETIMEDOUT 1.2.3.4:443",
    "socket hang up",
    "Connection error.",
    "network error",
    "other side closed",
    "fetch failed: UND_ERR_SOCKET",
  ]) {
    expect(isNetworkErrorMessage(message), message).toBe(true);
  }

  for (const message of [
    "401 Unauthorized: invalid api key",
    "429 rate limit exceeded",
    "This model's context window is 200000 tokens",
    "insufficient balance",
    "Request was aborted",
    "AbortError: The user aborted a request.",
    "",
    "Tool execution failed",
  ]) {
    expect(isNetworkErrorMessage(message), message).toBe(false);
  }
});

test("preference patches only accept the offered choices", () => {
  expect(isNetworkResumeMaxAttempts(0)).toBe(true);
  expect(isNetworkResumeMaxAttempts(7)).toBe(false);
  expect(defaultNetworkResumePreferences).toEqual({ enabled: true, maxAttempts: 5 });
  expect(
    applyNetworkResumePreferencesPatch(defaultNetworkResumePreferences, { maxAttempts: 7 }),
  ).toEqual(defaultNetworkResumePreferences);
  expect(
    applyNetworkResumePreferencesPatch(defaultNetworkResumePreferences, {
      enabled: false,
      maxAttempts: 10,
    }),
  ).toEqual({ enabled: false, maxAttempts: 10 });
});

test("a network failure joins the waiting list, an ordinary failure leaves it", () => {
  const harness = createHarness();
  harness.service.handleEvent(failure("fetch failed"));
  expect(harness.service.listWaiting()).toHaveLength(1);
  expect(harness.service.listWaiting()[0]).toMatchObject({ attempts: 0, workspaceId: "ws" });

  harness.service.handleEvent(failure("401 invalid api key"));
  expect(harness.service.listWaiting()).toHaveLength(0);
});

test("nothing resumes before the network answers twice in a row", async () => {
  const harness = createHarness();
  harness.service.handleEvent(failure("socket hang up"));

  await harness.service.probeNow();
  expect(harness.delivered).toHaveLength(0);

  harness.setReachable(true);
  await harness.service.probeNow();
  expect(harness.delivered).toHaveLength(0);

  await harness.service.probeNow();
  expect(harness.delivered).toEqual(["继续"]);

  harness.service.handleEvent(running());
  expect(harness.service.listWaiting()).toHaveLength(0);
});

test("a thread already running is never sent another continue", async () => {
  const harness = createHarness();
  harness.service.handleEvent(failure("fetch failed"));
  harness.setState({ status: "running" });
  harness.setReachable(true);
  await harness.service.probeNow();
  await harness.service.probeNow();
  expect(harness.delivered).toHaveLength(0);
});

test("an archived thread leaves the list instead of being resumed", async () => {
  const harness = createHarness();
  harness.service.handleEvent(failure("fetch failed"));
  harness.setState({ status: "failed", archivedAt: "2026-11-11T00:00:00.000Z" });
  harness.setReachable(true);
  await harness.service.probeNow();
  await harness.service.probeNow();
  expect(harness.delivered).toHaveLength(0);
  expect(harness.service.listWaiting()).toHaveLength(0);
});

test("the cap stops a thread that keeps failing", async () => {
  const harness = createHarness();
  harness.setPreferences({ maxAttempts: 3 });
  harness.setReachable(true);

  for (let attempt = 0; attempt < 3; attempt += 1) {
    // Each continue starts a run; the next failure is what the store reports afterwards.
    harness.setState({ status: "failed" });
    harness.service.handleEvent(failure("fetch failed"));
    await harness.service.probeNow();
    await harness.service.probeNow();
    expect(harness.delivered).toHaveLength(attempt + 1);
  }

  // The fourth failure hits the cap and stays in the list for the person to see.
  harness.setState({ status: "failed" });
  harness.service.handleEvent(failure("fetch failed"));
  await harness.service.probeNow();
  await harness.service.probeNow();
  expect(harness.delivered).toHaveLength(3);
  expect(harness.service.listWaiting()[0]?.exhausted).toBe(true);
});

test("switching the watcher off drops what it was holding", () => {
  const harness = createHarness();
  harness.service.handleEvent(failure("fetch failed"));
  expect(harness.service.listWaiting()).toHaveLength(1);

  harness.setPreferences({ enabled: false });
  harness.service.preferencesChanged();
  expect(harness.service.listWaiting()).toHaveLength(0);
});

test("a disabled watcher ignores failures entirely", () => {
  const harness = createHarness();
  harness.setPreferences({ enabled: false });
  harness.service.handleEvent(failure("fetch failed"));
  expect(harness.service.listWaiting()).toHaveLength(0);
});
