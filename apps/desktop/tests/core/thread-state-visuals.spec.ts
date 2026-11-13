import { expect, test, type Page } from "@playwright/test";
import {
  launchDesktop,
  makeUserDataDir,
  makeWorkspace,
  selectSession,
  waitForWorkspaceByPath,
} from "../helpers/electron-app";
import { createThread, setSessionVisibilityOverride } from "../helpers/session-event-test-helpers";
import {
  emitAttentionRequest,
  emitCompletedEvent,
  emitFailedEvent,
  emitRunningEvent,
} from "../helpers/notification-events";

/** `#rrggbb` as the browser reports it, so computed styles can be compared. */
function rgbOf(hex: string): string {
  const channels = [1, 3, 5].map((index) => Number.parseInt(hex.slice(index, index + 2), 16));
  return `rgb(${channels.join(", ")})`;
}

async function statusTokens(window: Page): Promise<Record<string, string>> {
  const values = await window.evaluate(() => {
    const style = getComputedStyle(document.documentElement);
    return Object.fromEntries(
      ["running", "attention", "error", "pending"].map((name) => [
        name,
        style.getPropertyValue(`--status-${name}`).trim(),
      ]),
    );
  });
  return values;
}

async function backgroundOf(window: Page, selector: string, text?: string): Promise<string> {
  const locator = text ? window.locator(selector, { hasText: text }) : window.locator(selector);
  return locator.first().evaluate((element) => getComputedStyle(element).backgroundColor);
}

/**
 * The four states a user scans for must be distinguishable without a tooltip,
 * and must not change meaning with the editor theme: each gets its own fixed
 * colour, its own mark, and a tint over the whole tab or row.
 */
test("running, unread, failed and waiting read apart in the strip and the list", async () => {
  test.setTimeout(120_000);

  const userDataDir = await makeUserDataDir();
  const workspacePath = await makeWorkspace("thread-state-visuals");
  const harness = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();
    await waitForWorkspaceByPath(window, workspacePath);
    const running = await createThread(window, "Running session");
    const unread = await createThread(window, "Unread session");
    const failed = await createThread(window, "Failed session");
    const waiting = await createThread(window, "Waiting session");

    await setSessionVisibilityOverride(harness, "inactive");
    await emitRunningEvent(harness, running, "Running");
    // An unread mark needs a recorded view: select it, then let it finish in the
    // background like a conversation the user switched away from.
    await selectSession(window, "Unread session");
    await setSessionVisibilityOverride(harness, "inactive");
    const unreadRun = await emitRunningEvent(harness, unread, "Unread");
    await emitCompletedEvent(harness, unread, "Unread", unreadRun);
    await selectSession(window, "Waiting session");
    await emitFailedEvent(harness, failed, "Failed", "boom");
    await window.waitForTimeout(1_000);

    const tokens = await statusTokens(window);
    expect(tokens.running).toMatch(/^#[0-9a-f]{6}$/);

    const tabOf = (title: string) => window.locator(".thread-tabs__tab", { hasText: title });
    await expect(tabOf("Running session")).toHaveClass(/thread-tabs__tab--running/);
    await expect(tabOf("Unread session")).toHaveClass(/thread-tabs__tab--unseen/);
    await expect(tabOf("Failed session")).toHaveClass(/thread-tabs__tab--failed/);
    await expect(tabOf("Waiting session")).toHaveClass(/thread-tabs__tab--idle/);

    // Marks: a hollow ring while running, solid dots once the turn is over.
    const runningDot = window.locator(".thread-tabs__tab--running .thread-tabs__dot").first();
    await expect(runningDot).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
    await expect(runningDot).toHaveCSS("border-top-color", rgbOf(tokens.running!));
    await expect(window.locator(".thread-tabs__tab--unseen .thread-tabs__dot").first()).toHaveCSS(
      "background-color",
      rgbOf(tokens.attention!),
    );
    await expect(window.locator(".thread-tabs__tab--failed .thread-tabs__dot").first()).toHaveCSS(
      "background-color",
      rgbOf(tokens.error!),
    );
    await expect(window.locator(".thread-tabs__tab--idle .thread-tabs__dot")).toHaveCount(0);

    // Tints: four different tab backgrounds, so the state is an area not a dot.
    const tabBackgrounds = await Promise.all([
      backgroundOf(window, ".thread-tabs__tab--running"),
      backgroundOf(window, ".thread-tabs__tab--unseen"),
      backgroundOf(window, ".thread-tabs__tab--failed"),
      backgroundOf(window, ".thread-tabs__tab--idle"),
    ]);
    expect(new Set(tabBackgrounds).size).toBe(4);

    // The list speaks the same language.
    await window.getByTestId("topbar-threads").click();
    await expect(window.getByTestId("thread-overview")).toBeVisible();
    const rowOf = (title: string) => window.locator(".session-row", { hasText: title });
    await expect(rowOf("Running session")).toHaveAttribute("data-sidebar-indicator", "running");
    await expect(rowOf("Unread session")).toHaveAttribute("data-sidebar-indicator", "unseen");
    await expect(rowOf("Failed session")).toHaveAttribute("data-sidebar-indicator", "failed");
    const rowBackgrounds = await Promise.all([
      backgroundOf(window, ".session-row", "Running session"),
      backgroundOf(window, ".session-row", "Unread session"),
      backgroundOf(window, ".session-row", "Failed session"),
      backgroundOf(window, ".session-row", "Waiting session"),
    ]);
    expect(new Set(rowBackgrounds).size).toBe(4);
    await expect(window.locator(".session-row__status--unseen")).toHaveCSS(
      "background-color",
      rgbOf(tokens.attention!),
    );
    await window.keyboard.press("Escape");

    // Waiting for an answer outranks the rest: a violet badge and a violet tab.
    await emitAttentionRequest(harness, waiting, "Waiting", "Approve the plan");
    await window.waitForTimeout(1_000);
    await expect(window.locator(".thread-tabs__tab--input")).toHaveCount(1);
    await expect(window.locator(".thread-tabs__badge--input")).toHaveCSS(
      "background-color",
      rgbOf(tokens.pending!),
    );
    const pendingTab = await backgroundOf(window, ".thread-tabs__tab--input");
    expect(pendingTab).not.toBe(tabBackgrounds[0]);

    // Status colours are fixed, so another preset cannot restyle the states.
    const otherPreset = await window.evaluate(async (expected) => {
      const app = (window as unknown as { piApp: Record<string, unknown> }).piApp as {
        setThemePresetId: (id: string) => Promise<unknown>;
      };
      await app.setThemePresetId("gruvbox");
      await new Promise((resolve) => setTimeout(resolve, 300));
      const style = getComputedStyle(document.documentElement);
      return {
        running: style.getPropertyValue("--status-running").trim(),
        same: style.getPropertyValue("--status-running").trim() === expected,
      };
    }, tokens.running);
    expect(otherPreset.same).toBe(true);
  } finally {
    await harness.close();
  }
});
