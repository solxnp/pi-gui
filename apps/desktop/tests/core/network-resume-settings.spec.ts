import { expect, test, type Locator } from "@playwright/test";
import {
  getDesktopState,
  launchDesktop,
  makeUserDataDir,
  makeWorkspace,
} from "../helpers/electron-app";

/* Labels follow the OS language, so each matcher accepts either shipped locale. */
const SETTINGS = /^(Settings|设置)$/;
const BACK_TO_APP = /^(Back to app|返回应用)$/;
const NETWORK_RESUME = /^(Network recovery|网络恢复)$/;
const ENABLED = /^(Resume after the network is back|网络恢复后自动续跑)$/;
const INTERVAL = /^(How often to check|探测间隔)$/;
const STREAK = /^(Clean checks before resuming|连续成功几次算网络恢复)$/;
const GIVE_UP = /^(Stop waiting after|探测失败多少次后放弃)$/;
const LIMIT = /^(Continues per thread|每个对话最多续跑)$/;

async function optionsOf(select: Locator): Promise<string[]> {
  return select
    .locator("option")
    .evaluateAll((options) => options.map((option) => (option as HTMLOptionElement).value));
}

async function openNetworkResume(window: Parameters<typeof getDesktopState>[0]): Promise<void> {
  if (
    !(await window
      .getByTestId("settings-surface")
      .isVisible()
      .catch(() => false))
  ) {
    await window.getByRole("button", { name: SETTINGS }).click();
  }
  await window.getByRole("button", { name: NETWORK_RESUME }).click();
  await expect(window.getByRole("heading", { name: NETWORK_RESUME })).toBeVisible();
}

test("offers the watcher switch and every timing knob", async () => {
  const userDataDir = await makeUserDataDir();
  const workspacePath = await makeWorkspace("network-resume-workspace");
  const harness = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();
    await openNetworkResume(window);

    const enabled = window.getByRole("switch", { name: ENABLED });
    await expect(enabled).toBeChecked();
    await expect(window.locator(".settings-view")).toContainText(
      /No thread is waiting|没有对话在等待/,
    );

    // Values are stable across languages; the labels are translated copy.
    // Ten clean checks a minute apart, then stop waiting after ten empty ones.
    const interval = window.getByRole("combobox", { name: INTERVAL });
    await expect(interval).toHaveValue("60000");
    expect(await optionsOf(interval)).toEqual(["15000", "30000", "60000", "120000"]);

    const streak = window.getByRole("combobox", { name: STREAK });
    await expect(streak).toHaveValue("10");
    expect(await optionsOf(streak)).toEqual(["1", "2", "5", "10"]);

    const giveUp = window.getByRole("combobox", { name: GIVE_UP });
    await expect(giveUp).toHaveValue("10");
    expect(await optionsOf(giveUp)).toEqual(["10", "20", "60", "0"]);

    const limit = window.getByRole("combobox", { name: LIMIT });
    await expect(limit).toBeVisible();
    expect(await optionsOf(limit)).toEqual(["3", "5", "10", "0"]);
  } finally {
    await harness.close();
  }
});

test("keeps the switch and the timing knobs after a restart", async () => {
  test.setTimeout(90_000);
  const userDataDir = await makeUserDataDir();
  const workspacePath = await makeWorkspace("network-resume-persist-workspace");

  let harness = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });
  try {
    const window = await harness.firstWindow();
    await openNetworkResume(window);
    await window.getByRole("switch", { name: ENABLED }).click();
    await window.getByRole("combobox", { name: LIMIT }).selectOption("10");
    // A change must land in the live state, which is what "takes effect immediately" rests on.
    await window.getByRole("combobox", { name: INTERVAL }).selectOption("30000");
    await window.getByRole("combobox", { name: STREAK }).selectOption("5");
    await window.getByRole("combobox", { name: GIVE_UP }).selectOption("0");
    await expect
      .poll(async () => (await getDesktopState(window)).networkResumePreferences)
      .toEqual({
        enabled: false,
        maxAttempts: 10,
        probeIntervalMs: 30_000,
        consecutiveSuccesses: 5,
        giveUpAfterFailedProbes: 0,
      });
  } finally {
    await harness.close();
  }

  harness = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });
  try {
    const window = await harness.firstWindow();
    await openNetworkResume(window);
    await expect(window.getByRole("switch", { name: ENABLED })).not.toBeChecked();
    await expect(window.getByRole("combobox", { name: LIMIT })).toHaveValue("10");
    await expect(window.getByRole("combobox", { name: INTERVAL })).toHaveValue("30000");
    await expect(window.getByRole("combobox", { name: STREAK })).toHaveValue("5");
    await expect(window.getByRole("combobox", { name: GIVE_UP })).toHaveValue("0");
  } finally {
    await harness.close();
  }
});
