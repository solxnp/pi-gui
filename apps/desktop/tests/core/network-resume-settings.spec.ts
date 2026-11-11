import { expect, test } from "@playwright/test";
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

test("offers the watcher switch, the continue cap and an empty waiting list", async () => {
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
    // The cap selector offers the four shipped choices.
    const limit = window.getByRole("combobox", {
      name: /^(Continues per thread|每个对话最多续跑)$/,
    });
    await expect(limit).toBeVisible();
    // Values are stable across languages; the labels are translated copy.
    const values = await limit
      .locator("option")
      .evaluateAll((options) => options.map((option) => (option as HTMLOptionElement).value));
    expect(values).toEqual(["3", "5", "10", "0"]);
  } finally {
    await harness.close();
  }
});

test("keeps the switch and the cap after a restart", async () => {
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
    await window
      .getByRole("combobox", { name: /^(Continues per thread|每个对话最多续跑)$/ })
      .selectOption("10");
    await expect
      .poll(async () => (await getDesktopState(window)).networkResumePreferences)
      .toEqual({ enabled: false, maxAttempts: 10 });
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
    await expect(
      window.getByRole("combobox", { name: /^(Continues per thread|每个对话最多续跑)$/ }),
    ).toHaveValue("10");
  } finally {
    await harness.close();
  }
});
