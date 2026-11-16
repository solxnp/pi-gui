import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test, type Locator } from "@playwright/test";
import {
  createNamedThread,
  launchDesktop,
  makeUserDataDir,
  makeWorkspace,
  seedAgentDir,
  selectSession,
  waitForWorkspaceByPath,
  writeProjectExtension,
} from "../helpers/electron-app";

// Fixed timestamp for everything the scripted model emits, so the clock text asserted after a
// restart is exact without depending on when the test runs. The local reading is computed from
// it, never hard-coded.
const SCRIPTED_AT = Date.parse("2026-03-04T05:06:00.000Z");
const THREAD_TITLE = "Clock probe";

function expectedClock(ms: number): string {
  const date = new Date(ms);
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

const extensionSource = String.raw`
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai";

const SCRIPTED_AT = ${SCRIPTED_AT};

export default function clockProbe(pi) {
  pi.registerProvider("clock-probe-test", {
    baseUrl: "http://127.0.0.1:9/never-contact",
    apiKey: "LOCAL_TEST_CANARY",
    api: "clock-probe-test",
    models: [{
      id: "scripted",
      name: "Scripted",
      reasoning: false,
      input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 128000,
      maxTokens: 4096,
    }],
    streamSimple(model, context) {
      const called = context.messages.some((message) => message.role === "toolResult");
      const content = called
        ? [{ type: "text", text: "Ran the command." }]
        : [{ type: "toolCall", id: "clock-1", name: "bash", arguments: { command: "echo hi" } }];
      const message = {
        role: "assistant",
        content,
        api: model.api,
        provider: model.provider,
        model: model.id,
        usage: {
          input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
        stopReason: called ? "stop" : "toolUse",
        timestamp: SCRIPTED_AT,
      };
      const stream = createAssistantMessageEventStream();
      queueMicrotask(() => {
        stream.push({ type: "start", partial: { ...message, content: [] } });
        if (called) stream.push({ type: "text_delta", contentIndex: 0, delta: content[0].text, partial: message });
        stream.push({ type: "done", reason: message.stopReason, message });
      });
      return stream;
    },
  });
}
`;

async function edge(locator: Locator, side: "left" | "right"): Promise<number> {
  const box = await locator.boundingBox();
  if (!box) throw new Error("element has no box");
  return Math.round(side === "left" ? box.x : box.x + box.width);
}

/** A clock shows `HH:MM`, and its `dateTime` is what the text was formatted from. */
async function expectClock(clock: Locator): Promise<void> {
  await expect(clock).toHaveText(/^\d{2}:\d{2}$/);
  const dateTime = await clock.getAttribute("dateTime");
  expect(dateTime, "a clock carries the timestamp it was formatted from").toBeTruthy();
  expect(await clock.textContent()).toBe(expectedClock(Date.parse(dateTime!)));
}

/**
 * Clock times come from the session's own message timestamps — no model call — so a long silent
 * run still shows when each row arrived. Model-side rows keep the time on the left; a prompt's
 * time sits on the right, in the gutter of whoever spoke.
 */
test("transcript rows show when they arrived, model rows left and prompts right", async () => {
  test.setTimeout(180_000);
  const userDataDir = await makeUserDataDir();
  const agentDir = join(userDataDir, "agent");
  const workspacePath = await makeWorkspace("transcript-timestamps");
  await seedAgentDir(agentDir, { withOpenAiAuth: false, withDefaultModel: false });
  await writeFile(
    join(agentDir, "settings.json"),
    JSON.stringify({
      defaultProvider: "clock-probe-test",
      defaultModel: "scripted",
      enabledModels: ["clock-probe-test/scripted"],
      packages: [],
      cacheWarming: "off",
      compaction: { enabled: false },
    }),
  );
  await writeProjectExtension(workspacePath, "clock-probe.ts", extensionSource);
  const launch = () =>
    launchDesktop(userDataDir, {
      agentDir,
      initialWorkspaces: [workspacePath],
      scrubProviderEnv: true,
      testMode: "background",
    });

  const firstRun = await launch();
  try {
    const window = await firstRun.firstWindow();
    await waitForWorkspaceByPath(window, workspacePath);
    await createNamedThread(window, THREAD_TITLE);
    const composer = window.getByTestId("composer");
    await composer.click();
    await composer.fill("Run the command.");
    await composer.press("Enter");

    const transcript = window.getByTestId("transcript");
    await expect(transcript.locator(".timeline-tool")).toHaveCount(1, { timeout: 60_000 });

    // Live rows carry the moment the app received them.
    const liveToolTime = transcript.locator(".timeline-tool__time");
    await expectClock(liveToolTime);
    const receivedAt = Date.parse((await liveToolTime.getAttribute("dateTime"))!);
    expect(Math.abs(Date.now() - receivedAt)).toBeLessThan(10 * 60_000);
    await expectClock(transcript.locator(".timeline-item--assistant .timeline-item__clock--start"));
    await expectClock(transcript.locator(".timeline-item--user .timeline-item__clock--end"));
  } finally {
    await firstRun.close();
  }

  // Reopened from the saved session, the clocks are the messages' own timestamps.
  const secondRun = await launch();
  try {
    const window = await secondRun.firstWindow();
    await waitForWorkspaceByPath(window, workspacePath);
    await selectSession(window, THREAD_TITLE);

    const transcript = window.getByTestId("transcript");
    const toolTime = transcript.locator(".timeline-tool__time");
    await expect(toolTime).toHaveText(expectedClock(SCRIPTED_AT));
    await expect(toolTime).toHaveAttribute("dateTime", new Date(SCRIPTED_AT).toISOString());

    // The tool row's time leads the row, in front of its glyph.
    const glyph = transcript.locator(".timeline-tool__glyph");
    expect(await edge(toolTime, "right")).toBeLessThanOrEqual(await edge(glyph, "left"));

    // Model output keeps its time on the left, above the reply.
    const assistantClock = transcript.locator(
      ".timeline-item--assistant .timeline-item__clock--start",
    );
    await expect(assistantClock).toHaveText(expectedClock(SCRIPTED_AT));
    const reply = transcript.locator(".timeline-item--assistant .message__content").first();
    expect(
      Math.abs((await edge(assistantClock, "left")) - (await edge(reply, "left"))),
    ).toBeLessThanOrEqual(2);

    // The prompt's time sits on the right, level with the bubble's right edge.
    const userClock = transcript.locator(".timeline-item--user .timeline-item__clock--end");
    const bubble = transcript.locator(".timeline-item--user .timeline-item__bubble");
    await expectClock(userClock);
    expect(
      Math.abs((await edge(userClock, "right")) - (await edge(bubble, "right"))),
    ).toBeLessThanOrEqual(2);
  } finally {
    await secondRun.close();
  }
});
