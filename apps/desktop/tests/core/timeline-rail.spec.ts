import { expect, test } from "@playwright/test";
import {
  createNamedThread,
  getDesktopState,
  launchDesktop,
  makeUserDataDir,
  makeWorkspace,
  streamAssistantDeltas,
  waitForWorkspaceByPath,
} from "../helpers/electron-app";
import { appendMessagesToSessionFile, sessionFilePathFromCatalog } from "../helpers/session-file";

const PROMPT_COUNT = 6;

function userPrompt(index: number): string {
  return `Prompt number ${index}: check the deploy script before the release`;
}

function assistantReply(index: number): string {
  return `Reply to prompt ${index}. ` + "Detail line that makes the thread tall. ".repeat(40);
}

test("the prompt rail previews a prompt and jumps to it from far down the thread", async () => {
  test.setTimeout(120_000);
  const userDataDir = await makeUserDataDir();
  const workspacePath = await makeWorkspace("timeline-rail-workspace");
  const firstRun = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });

  let workspaceId = "";
  let sessionId = "";
  try {
    const window = await firstRun.firstWindow();
    await waitForWorkspaceByPath(window, workspacePath);
    await createNamedThread(window, "Rail proof thread");
    const state = await getDesktopState(window);
    workspaceId = state.selectedWorkspaceId;
    sessionId = state.selectedSessionId;
    expect(workspaceId).toBeTruthy();
    expect(sessionId).toBeTruthy();
  } finally {
    await firstRun.close();
  }

  const sessionFilePath = await sessionFilePathFromCatalog(userDataDir, { workspaceId, sessionId });
  await appendMessagesToSessionFile(
    sessionFilePath,
    Array.from({ length: PROMPT_COUNT }, (_, offset) => [
      { role: "user" as const, text: userPrompt(offset + 1) },
      { role: "assistant" as const, text: assistantReply(offset + 1) },
    ]).flat(),
  );

  const secondRun = await launchDesktop(userDataDir, { testMode: "background" });
  try {
    const window = await secondRun.firstWindow();
    await waitForWorkspaceByPath(window, workspacePath);
    const pane = window.getByTestId("timeline-pane");
    await expect(pane).toContainText(userPrompt(PROMPT_COUNT));

    // One tick per prompt, in thread order, even for prompts scrolled out of the window.
    const ticks = window.getByTestId("timeline-rail-tick");
    await expect(ticks).toHaveCount(PROMPT_COUNT);
    await expect(ticks.nth(2)).toHaveAttribute("aria-label", `Your message 3 of ${PROMPT_COUNT}`);

    // Reading the bottom marks the newest prompt, so the rail shows where the thread stands.
    await expect(ticks.nth(PROMPT_COUNT - 1)).toHaveAttribute("aria-current", "true");

    // Hovering a tick previews what was asked, without moving the viewport.
    const beforeHover = await pane.evaluate((element) => element.scrollTop);
    await ticks.nth(2).hover();
    const preview = window.getByTestId("timeline-rail-preview");
    await expect(preview).toBeVisible();
    await expect(preview).toContainText(`Your message 3 of ${PROMPT_COUNT}`);
    await expect(preview).toContainText("Prompt number 3");
    await expect(preview).toContainText("Click to jump");
    expect(await pane.evaluate((element) => element.scrollTop)).toBe(beforeHover);

    // Clicking that tick brings its prompt to the top of the pane and marks it current.
    await ticks.nth(2).click();
    const thirdPrompt = window.locator(".timeline-item--user", { hasText: userPrompt(3) });
    await expect(thirdPrompt).toBeVisible();
    await expect
      .poll(async () => {
        const [row, box] = await Promise.all([thirdPrompt.boundingBox(), pane.boundingBox()]);
        if (!row || !box) return -999;
        return row.y - box.y;
      })
      .toBeGreaterThanOrEqual(-1);
    await expect
      .poll(async () => {
        const [row, box] = await Promise.all([thirdPrompt.boundingBox(), pane.boundingBox()]);
        if (!row || !box) return 999;
        return row.y - box.y;
      })
      .toBeLessThan(8);
    await expect(ticks.nth(2)).toHaveAttribute("aria-current", "true");
    await expect(ticks.nth(0)).not.toHaveAttribute("aria-current", "true");

    // The rail is outside the scroller, so wheel motion over it must still scroll the thread.
    const beforeWheel = await pane.evaluate((element) => element.scrollTop);
    await ticks.nth(2).hover();
    await window.mouse.wheel(0, 300);
    await expect
      .poll(async () => pane.evaluate((element) => element.scrollTop))
      .toBeGreaterThan(beforeWheel);

    // Leaving the bottom keeps the reader in place while new activity arrives.
    await streamAssistantDeltas(secondRun, window, ["New activity arrived while reading. "]);
    await expect(window.getByTestId("timeline-jump")).toBeVisible();
    await expect(thirdPrompt).toBeVisible();
    await ticks.nth(PROMPT_COUNT - 1).click();
    await expect(
      window.locator(".timeline-item--user", { hasText: userPrompt(PROMPT_COUNT) }),
    ).toBeVisible();
    await expect(ticks.nth(PROMPT_COUNT - 1)).toHaveAttribute("aria-current", "true");

    const metrics = await pane.evaluate((element) => ({
      scrollTop: element.scrollTop,
      remaining: element.scrollHeight - element.scrollTop - element.clientHeight,
    }));
    expect(metrics.scrollTop).toBeGreaterThan(0);
  } finally {
    await secondRun.close();
  }
});

test("a thread with a single prompt shows no rail", async () => {
  const userDataDir = await makeUserDataDir();
  const workspacePath = await makeWorkspace("timeline-rail-single-workspace");
  const firstRun = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });

  let workspaceId = "";
  let sessionId = "";
  try {
    const window = await firstRun.firstWindow();
    await waitForWorkspaceByPath(window, workspacePath);
    await createNamedThread(window, "Rail single prompt");
    const state = await getDesktopState(window);
    workspaceId = state.selectedWorkspaceId;
    sessionId = state.selectedSessionId;
  } finally {
    await firstRun.close();
  }

  const sessionFilePath = await sessionFilePathFromCatalog(userDataDir, { workspaceId, sessionId });
  await appendMessagesToSessionFile(sessionFilePath, [
    { role: "user", text: userPrompt(1) },
    { role: "assistant", text: assistantReply(1) },
  ]);

  const secondRun = await launchDesktop(userDataDir, { testMode: "background" });
  try {
    const window = await secondRun.firstWindow();
    await waitForWorkspaceByPath(window, workspacePath);
    await expect(window.getByTestId("timeline-pane")).toContainText(userPrompt(1));
    await expect(window.getByTestId("timeline-rail")).toHaveCount(0);
  } finally {
    await secondRun.close();
  }
});
