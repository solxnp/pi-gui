import { expect, test } from "@playwright/test";
import { launchDesktop, makeUserDataDir, makeWorkspace } from "../helpers/electron-app";

/* The app follows the OS language, so every label below matches either shipped locale. */
const EXTENSIONS_BUTTON = /^(Extensions|扩展)$/;
const BACK_TO_APP = /^(Back to app|返回应用)$/;
const PI_GUI_TOOLS = /^(pi-gui tools|pi-gui 工具)( \d+)?$/;
const GATE_SUMMARY = /(Asks before a dangerous command|执行危险命令、读写凭据文件前先问你)/;
const GATE_DETAIL = /(39 rules|39 条)/;
const SOURCE_ROW = /Source|来源/;

test("built-in extensions explain themselves in the app's language", async () => {
  const userDataDir = await makeUserDataDir();
  const workspacePath = await makeWorkspace("extension-copy-workspace");
  const harness = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();
    await window.getByRole("button", { name: EXTENSIONS_BUTTON }).click();

    const list = window.getByTestId("extensions-list");
    const gateRow = list.locator('[data-resource-id="<inline:pi-gui-permission-gate>"]');
    await expect(gateRow).toBeVisible();
    await expect(gateRow).toContainText(GATE_SUMMARY);
    // The switch's accessible name follows the visible name, not the English data from main.
    await expect(
      window.getByRole("switch", {
        name: /^(Enable Permission gate|启用权限确认|启用 Permission gate)$/,
      }),
    ).toHaveCount(1);
    await expect(list.getByRole("heading", { name: PI_GUI_TOOLS })).toBeVisible();

    await gateRow.click();
    const detail = window.locator(".resource-detail");
    await expect(detail).toContainText(GATE_DETAIL);
    await expect(detail).toContainText(SOURCE_ROW);
    // No dropped English data: the detail title is the translated name.
    await expect(
      detail.getByRole("heading", { name: /^(Permission gate|权限确认)$/ }),
    ).toBeVisible();
  } finally {
    await harness.close();
  }
});
