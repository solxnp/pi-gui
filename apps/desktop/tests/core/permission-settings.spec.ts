import { expect, test, type Page } from "@playwright/test";
import {
  getDesktopState,
  launchDesktop,
  makeUserDataDir,
  makeWorkspace,
} from "../helpers/electron-app";

/* Labels follow the OS language, so the spec matches either shipped locale. */
const SETTINGS = /^(Settings|设置)$/;
const PERMISSIONS = /^(Permissions|权限确认)$/;
const EXTENSIONS = /^(Extensions|扩展)$/;
const MASTER = /^(Ask before dangerous actions|危险操作前先问)$/;
const DELETE_DISK = /^(Deleting and disks|删除与磁盘操作)$/;
const CREDENTIAL_FILES = /^(Reading and writing credentials files|读写凭据文件)$/;
const CREDENTIAL_COMMANDS = /^(Reaching credentials files from a command|命令行访问凭据文件)$/;
const ENABLE_GATE = /^(Enable Permission gate|启用权限确认|启用 权限确认)$/;
const EXPAND = /^(Expand|展开)$/;
const COLLAPSE = /^(Collapse|收起)$/;
const BACK_TO_APP = /^(Back to app|返回应用)$/;

/** A restart reopens Settings, while the section resets to General; both entries land here. */
async function openPermissions(window: Page): Promise<void> {
  if (
    !(await window
      .getByTestId("settings-surface")
      .isVisible()
      .catch(() => false))
  ) {
    await window.getByRole("button", { name: SETTINGS }).click();
  }
  await window.getByRole("button", { name: PERMISSIONS }).click();
  await expect(window.getByRole("heading", { name: PERMISSIONS })).toBeVisible();
}

async function permissionCategories(window: Page) {
  const state = await getDesktopState(window);
  return state.permissionPreferences.categories;
}

test("starts with the credentials command rule off and keeps a change after restart", async () => {
  test.setTimeout(90_000);
  const userDataDir = await makeUserDataDir();
  const workspacePath = await makeWorkspace("permission-settings-workspace");

  let harness = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });
  try {
    const window = await harness.firstWindow();
    await openPermissions(window);

    const commandsFromShell = window.getByRole("switch", { name: CREDENTIAL_COMMANDS });
    const filesByTool = window.getByRole("switch", { name: CREDENTIAL_FILES });
    await expect(commandsFromShell).not.toBeChecked();
    await expect(filesByTool).toBeChecked();

    await commandsFromShell.click();
    await expect(commandsFromShell).toBeChecked();
    await expect
      .poll(() => permissionCategories(window))
      .toMatchObject({
        "credential-commands": true,
        "credential-files": true,
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
    await openPermissions(window);
    await expect(window.getByRole("switch", { name: CREDENTIAL_COMMANDS })).toBeChecked();
  } finally {
    await harness.close();
  }
});

test("the master switch silences every category and matches the extensions list", async () => {
  test.setTimeout(90_000);
  const userDataDir = await makeUserDataDir();
  const workspacePath = await makeWorkspace("permission-master-workspace");

  const harness = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });
  try {
    const window = await harness.firstWindow();
    await openPermissions(window);

    const master = window.getByRole("switch", { name: MASTER });
    const deleteCategory = window.getByRole("switch", { name: DELETE_DISK });
    await expect(master).toBeChecked();
    await expect(deleteCategory).toBeEnabled();

    await master.click();
    await expect(master).not.toBeChecked();
    await expect(deleteCategory).toBeDisabled();
    await expect
      .poll(async () => (await getDesktopState(window)).permissionPreferences.enabled)
      .toBe(false);

    // The same setting backs the built-in extension's switch on the Extensions page.
    await window.getByRole("button", { name: BACK_TO_APP }).click();
    await window.getByRole("button", { name: EXTENSIONS }).click();
    const gateSwitch = window.getByRole("switch", { name: ENABLE_GATE });
    await expect(gateSwitch).not.toBeChecked();

    await gateSwitch.click();
    await expect(gateSwitch).toBeChecked();
    await window.getByRole("button", { name: BACK_TO_APP }).click();
    await openPermissions(window);
    await expect(window.getByRole("switch", { name: MASTER })).toBeChecked();
    await expect(window.getByRole("switch", { name: DELETE_DISK })).toBeEnabled();
  } finally {
    await harness.close();
  }
});

test("lists the rules behind each category only after the row is expanded", async () => {
  const userDataDir = await makeUserDataDir();
  const workspacePath = await makeWorkspace("permission-rules-workspace");
  const harness = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });
  try {
    const window = await harness.firstWindow();
    await openPermissions(window);

    const view = window.locator(".settings-view");
    await expect(view).not.toContainText("环境变量文件");
    await window.getByRole("button", { name: EXPAND }).click();

    await expect(view).toContainText(/39/);
    // The command-side rule the page promises to silence is listed under its own heading.
    await expect(view).toContainText("通过命令访问文件名像密钥 / token 的文件");
    await expect(view).toContainText("环境变量文件，通常放着 API Key、Token、数据库密码");

    await window.getByRole("button", { name: COLLAPSE }).click();
    await expect(view).not.toContainText("环境变量文件");
  } finally {
    await harness.close();
  }
});
