import { basename } from "node:path";
import { expect, type Page } from "@playwright/test";
import type { DesktopHarness } from "../helpers/electron-app";
import { openThreadOverview, waitForWorkspaceByPath } from "../helpers/electron-app";

export async function assertPackagedAppCanStartThread(
  harness: DesktopHarness,
  window: Page,
  options: {
    readonly expectedExecutablePath: string;
    readonly promptText: string;
    readonly workspacePath: string;
  },
): Promise<void> {
  await expect
    .poll(async () => {
      return harness.electronApp.evaluate(() => ({
        defaultApp: Boolean(process.defaultApp),
        execPath: process.execPath,
      }));
    })
    .toEqual({
      defaultApp: false,
      execPath: options.expectedExecutablePath,
    });

  await waitForWorkspaceByPath(window, options.workspacePath);
  // The workspace list sits in 「全部会话」 now; the app opens threads from the topbar.
  const overview = await openThreadOverview(window);
  await expect(overview.getByTestId("workspace-list")).toContainText(
    basename(options.workspacePath),
  );
  await window.keyboard.press("Escape");
  await expect(overview).toHaveCount(0);
  await window.getByTestId("topbar-new-thread").click();
  const prompt = window.getByLabel("New thread prompt");
  await expect(prompt).toBeVisible();
  await prompt.fill(options.promptText);
  await window.getByRole("button", { name: "Start thread" }).click();

  await expect(window.locator(".chat-header__title")).toHaveText(/\S+/);
  await expect(window.getByTestId("composer")).toBeFocused();
  await expect(window.getByTestId("transcript")).toContainText(options.promptText);
}
