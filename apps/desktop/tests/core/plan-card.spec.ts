import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import {
  assertExists,
  createNamedThread,
  launchDesktop,
  makeUserDataDir,
  makeWorkspace,
  seedAgentDir,
  waitForWorkspaceByPath,
  writeProjectExtension,
} from "../helpers/electron-app";

const PROVIDER_ID = "plan-card-test";
const MODEL_ID = "scripted";
const THREAD_TITLE = "Plan card";

// The scripted model calls the app's built-in update_plan tool once, then answers. The tool is the
// product surface under test: it must pin a card above the composer, and the second call must
// replace that card instead of stacking a new one.
const extensionSource = String.raw`
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai";

export default function plans(pi) {
  pi.registerProvider("plan-card-test", {
    baseUrl: "http://127.0.0.1:9/never-contact",
    apiKey: "LOCAL_TEST_CANARY",
    api: "plan-card-test",
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
      const results = context.messages.filter((message) => message.role === "toolResult");
      let content;
      if (results.length === 0) {
        content = [{
          type: "toolCall",
          id: "plan-1",
          name: "update_plan",
          arguments: {
            title: "计划",
            steps: [
              { step: "读台账", status: "done" },
              { step: "拆模块", status: "in_progress" },
              { step: "真机验证", status: "pending" },
              { step: "补测试", status: "pending" },
            ],
          },
        }];
      } else if (results.length === 1) {
        content = [{
          type: "toolCall",
          id: "plan-2",
          name: "update_plan",
          arguments: {
            title: "计划",
            steps: [
              { step: "读台账", status: "done" },
              { step: "拆模块", status: "in_progress", progress: 0.4 },
              { step: "真机验证", status: "pending" },
              { step: "补测试", status: "pending" },
            ],
          },
        }];
      } else if (results.length === 2) {
        content = [{
          type: "toolCall",
          id: "plan-3",
          name: "update_plan",
          arguments: {
            title: "计划",
            steps: [
              { step: "读台账", status: "done" },
              { step: "拆模块", status: "done" },
              { step: "真机验证", status: "in_progress", progress: 0.5 },
              { step: "补测试", status: "blocked", progress: 0.3 },
            ],
          },
        }];
      } else {
        content = [{ type: "text", text: "计划已更新。" }];
      }
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
        stopReason: results.length >= 3 ? "stop" : "toolUse",
        timestamp: Date.now(),
      };
      const stream = createAssistantMessageEventStream();
      queueMicrotask(() => {
        stream.push({ type: "start", partial: { ...message, content: [] } });
        if (message.stopReason === "stop") {
          stream.push({ type: "text_delta", contentIndex: 0, delta: content[0].text, partial: message });
        }
        stream.push({ type: "done", reason: message.stopReason, message });
      });
      return stream;
    },
  });
}
`;

async function send(window: Page, text: string) {
  const composer = window.getByTestId("composer");
  await composer.click();
  await composer.fill(text);
  await composer.press("Enter");
  await expect(composer).toHaveValue("");
}

test("update_plan pins the plan above the composer and rewrites it in place", async () => {
  test.setTimeout(120_000);
  const userDataDir = await makeUserDataDir();
  const agentDir = join(userDataDir, "agent");
  const workspacePath = await makeWorkspace("plan-card");
  await seedAgentDir(agentDir, { withOpenAiAuth: false, withDefaultModel: false });
  await writeFile(
    join(agentDir, "settings.json"),
    JSON.stringify({
      defaultProvider: PROVIDER_ID,
      defaultModel: MODEL_ID,
      enabledModels: [`${PROVIDER_ID}/${MODEL_ID}`],
      packages: [],
      cacheWarming: "off",
      compaction: { enabled: false },
    }),
  );
  await writeProjectExtension(workspacePath, "plans.ts", extensionSource);
  const harness = await launchDesktop(userDataDir, {
    agentDir,
    initialWorkspaces: [workspacePath],
    scrubProviderEnv: true,
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();
    await waitForWorkspaceByPath(window, workspacePath);
    await createNamedThread(window, THREAD_TITLE);

    const pinned = window.getByTestId("pinned-cards").getByTestId("extension-card");
    const transcriptCards = window.getByTestId("transcript").getByTestId("extension-card");
    await expect(pinned).toHaveCount(0);

    await send(window, "今天做什么？");

    // One card, above the composer, never in the timeline. Two update_plan calls resolved faster
    // than the assertions, so this waits for the final write and proves the earlier one was
    // replaced rather than stacked: the card count never leaves one.
    await expect(pinned).toHaveCount(1);
    await expect(transcriptCards).toHaveCount(0);
    await expect(pinned).toContainText("计划");
    await expect(pinned).toContainText("2/4 步完成");
    await expect(pinned).toContainText("拆模块");
    await expect(pinned).toContainText("真机验证");

    // The step number is gone; each row leads with a status icon instead.
    const statuses = pinned.getByTestId("extension-card-row-status");
    await expect(statuses).toHaveCount(4);
    const rowStates = await pinned
      .locator(".extension-card__row")
      .evaluateAll((rows) => rows.map((row) => row.getAttribute("data-row-status")));
    expect(rowStates).toEqual(["done", "done", "in_progress", "blocked"]);
    // The spec pins Chromium to en-US, so the labels are the English ones.
    await expect(statuses.first()).toHaveAttribute("aria-label", "Done");
    await expect(statuses.nth(2)).toHaveAttribute("aria-label", "In progress");
    await expect(statuses.last()).toHaveAttribute("aria-label", "Blocked");

    // The card's bar counts the running step's fraction too: 2 done + 0.5 running, over 4 steps.
    // Counting only finished steps would print 50% beside a row reading 45%/50%.
    const progress = pinned.getByTestId("extension-card-progress");
    await expect(progress).toHaveAttribute("data-percent", "63");
    await expect(progress).toContainText("63%");

    // Only the running step draws its own bar. The blocked row carries a fraction in the data
    // but must not draw one: a stopped step that showed a bar would read as still moving.
    const rowProgress = pinned.getByTestId("extension-card-row-progress");
    await expect(rowProgress).toHaveCount(1);
    await expect(rowProgress).toHaveAttribute("data-percent", "50");
    await expect(
      pinned.locator('[data-row-status="blocked"] [data-testid="extension-card-row-progress"]'),
    ).toHaveCount(0);
    // A done step's own bar is gone; the tick alone says it finished.
    await expect(
      pinned.locator('[data-row-status="done"] [data-testid="extension-card-row-progress"]'),
    ).toHaveCount(0);
    const pinBox = await pinned.boundingBox();
    const composerBox = await window.getByTestId("composer").boundingBox();
    assertExists(pinBox, "Expected the plan card box");
    assertExists(composerBox, "Expected the composer box");
    expect(pinBox.y + pinBox.height).toBeLessThanOrEqual(composerBox.y);

    // Collapse hides the rows but keeps the header, so the progress stays readable.
    const rows = pinned.locator(".extension-card__row");
    await expect(rows).toHaveCount(4);
    await pinned.getByTestId("pinned-card-toggle").click();
    await expect(rows).toHaveCount(0);
    await expect(pinned).toContainText("2/4 步完成");
  } finally {
    await harness.close();
  }
});
