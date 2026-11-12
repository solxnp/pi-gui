import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import type { SessionDriverEvent, SessionRef } from "@pi-gui/session-driver";
import {
  applyNetworkResumePreferencesPatch,
  defaultNetworkResumePreferences,
  isNetworkResumeGiveUpAfter,
  isNetworkResumeIntervalMs,
  isNetworkResumeMaxAttempts,
  isNetworkResumeSuccesses,
  type NetworkResumePreferences,
  type NetworkResumePreferencesPatch,
  type NetworkResumeWaitingRecord,
} from "../../contracts/network-resume";
import { isNetworkErrorMessage } from "../../electron/network-resume/network-error";
import { createNetworkResumeLog } from "../../electron/network-resume/network-resume-log";
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
  published: NetworkResumeWaitingRecord[][];
  delivered: string[];
  lines: string[];
  setReachable(value: boolean): void;
  setState(value: NetworkResumeSessionState | undefined): void;
  setPreferences(patch: NetworkResumePreferencesPatch): void;
}

function createHarness(): Harness {
  let reachable = false;
  let state: NetworkResumeSessionState | undefined = { status: "failed" };
  // Two clean checks in a row keep the specs short; what ships defaults to ten.
  let preferences: NetworkResumePreferences = {
    ...defaultNetworkResumePreferences,
    consecutiveSuccesses: 2,
  };
  const published: Harness["published"] = [];
  const delivered: string[] = [];
  const lines: string[] = [];
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
      log: (line) => lines.push(line),
    },
    {
      probe: async () => (reachable ? "reachable" : "unreachable"),
      now: () => Date.parse("2026-11-12T00:00:00.000Z"),
    },
  );
  service.start();
  return {
    service,
    published,
    delivered,
    lines,
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
    // The two texts that real outages actually ended on (2026-11-12): a body that stopped
    // mid-flight, and a request that ran out of time.
    "terminated",
    "Request timed out.",
    "The operation was aborted due to timeout",
    "connection lost",
    "stream ended without finish_reason",
  ]) {
    expect(isNetworkErrorMessage(message), message).toBe(true);
  }

  for (const message of [
    "401 Unauthorized: invalid api key",
    "429 rate limit exceeded",
    "This model's context window is 200000 tokens",
    "insufficient balance",
    "GoUsageLimitError: monthly usage limit reached",
    "Request was aborted",
    "AbortError: The user aborted a request.",
    "Run aborted",
    "",
    "Tool execution failed",
  ]) {
    expect(isNetworkErrorMessage(message), message).toBe(false);
  }
});

test("preference patches only accept the offered choices", () => {
  expect(isNetworkResumeMaxAttempts(0)).toBe(true);
  expect(isNetworkResumeMaxAttempts(7)).toBe(false);
  expect(isNetworkResumeIntervalMs(15_000)).toBe(true);
  expect(isNetworkResumeIntervalMs(45_000)).toBe(false);
  expect(isNetworkResumeSuccesses(10)).toBe(true);
  expect(isNetworkResumeSuccesses(3)).toBe(false);
  expect(isNetworkResumeGiveUpAfter(0)).toBe(true);
  expect(isNetworkResumeGiveUpAfter(5)).toBe(false);
  // Ten clean checks a minute apart before resuming, and stop after ten empty ones.
  expect(defaultNetworkResumePreferences).toEqual({
    enabled: true,
    maxAttempts: 5,
    probeIntervalMs: 60_000,
    consecutiveSuccesses: 10,
    giveUpAfterFailedProbes: 10,
  });
  expect(
    applyNetworkResumePreferencesPatch(defaultNetworkResumePreferences, {
      maxAttempts: 7,
      probeIntervalMs: 45_000,
      consecutiveSuccesses: 3,
      giveUpAfterFailedProbes: 5,
    }),
  ).toEqual(defaultNetworkResumePreferences);
  expect(
    applyNetworkResumePreferencesPatch(defaultNetworkResumePreferences, {
      enabled: false,
      maxAttempts: 10,
      probeIntervalMs: 30_000,
      consecutiveSuccesses: 5,
      giveUpAfterFailedProbes: 0,
    }),
  ).toEqual({
    enabled: false,
    maxAttempts: 10,
    probeIntervalMs: 30_000,
    consecutiveSuccesses: 5,
    giveUpAfterFailedProbes: 0,
  });
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

test("every decision leaves a line behind, so a quiet thread can be explained later", async () => {
  const harness = createHarness();
  harness.setReachable(true);

  harness.service.handleEvent(failure("terminated"));
  harness.service.handleEvent(
    failure("401 invalid api key", { workspaceId: "ws", sessionId: "s2" }),
  );
  await harness.service.probeNow();
  await harness.service.probeNow();

  const joined = harness.lines.join("\n");
  // The failure that used to be invisible: classified, then resumed.
  expect(joined).toContain("failure thread=ws:s1 network=true");
  expect(joined).toContain("message=terminated");
  // A refusal is logged with the verdict that kept it out of the list.
  expect(joined).toContain("network=false");
  expect(joined).toContain("probe result=reachable streak=1 failed=0 needed=2 waiting=1");
  expect(joined).toContain("continue thread=ws:s1 attempt=1 maxAttempts=5");
  // The run the continue started takes the thread off the list.
  harness.service.handleEvent(running());
  expect(harness.lines.join("\n")).toContain("drop thread=ws:s1 reason=running");
  expect(harness.lines.every((line) => /^\d{4}-\d\d-\d\dT/.test(line))).toBe(true);
});

test("the log writer appends lines in order and never throws into the watcher", async () => {
  const dir = await mkdtemp(join(tmpdir(), "network-resume-log-"));
  const logPath = join(dir, "nested", "network-resume.log");
  const log = createNetworkResumeLog(logPath);

  log("first line");
  log("second line");
  await expect
    .poll(() => readFile(logPath, "utf8").catch(() => ""), { timeout: 5_000 })
    .toBe("first line\nsecond line\n");

  // A path that cannot be a file must be swallowed, not raised.
  const broken = createNetworkResumeLog(join(dir, "network-resume.log", "impossible"));
  expect(() => broken("ignored")).not.toThrow();
});

test("the streak setting decides how many clean checks a resume needs", async () => {
  const harness = createHarness();
  harness.setPreferences({ consecutiveSuccesses: 10 });
  harness.service.handleEvent(failure("terminated"));
  harness.setReachable(true);

  for (let check = 0; check < 9; check += 1) {
    await harness.service.probeNow();
  }
  expect(harness.delivered).toHaveLength(0);

  // Lowering the streak takes effect on the next check, not after a restart.
  harness.setPreferences({ consecutiveSuccesses: 1 });
  harness.service.preferencesChanged();
  await harness.service.probeNow();
  expect(harness.delivered).toEqual(["继续"]);
  expect(harness.lines.join("\n")).toContain("preferences enabled=true maxAttempts=5");
  expect(harness.lines.join("\n")).toContain("consecutiveSuccesses=1");
});

test("failed checks are counted, capped, and cleared by one that answers", async () => {
  const harness = createHarness();
  harness.setPreferences({ giveUpAfterFailedProbes: 10 });
  harness.service.handleEvent(failure("Connection error."));

  for (let check = 0; check < 10; check += 1) {
    await harness.service.probeNow();
  }
  // Ten empty checks is the setting, so the thread leaves the list instead of waiting all night.
  expect(harness.service.listWaiting()).toHaveLength(0);
  expect(harness.lines.join("\n")).toContain("gave-up thread=ws:s1 failedProbes=10 limit=10");

  // 0 means the watcher never gives up on its own.
  harness.setPreferences({ giveUpAfterFailedProbes: 0 });
  harness.service.handleEvent(failure("Connection error."));
  for (let check = 0; check < 30; check += 1) {
    await harness.service.probeNow();
  }
  expect(harness.service.listWaiting()).toHaveLength(1);
  expect(harness.service.listWaiting()[0]?.failedProbes).toBe(30);

  // One clean check wipes the count, so a flapping link is not punished for the outage before it.
  harness.setReachable(true);
  await harness.service.probeNow();
  expect(harness.service.listWaiting()[0]?.failedProbes).toBe(0);
});
