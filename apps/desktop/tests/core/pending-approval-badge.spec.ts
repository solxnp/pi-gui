import { expect, test } from "@playwright/test";
import {
  createNamedThread,
  launchDesktop,
  makeUserDataDir,
  makeWorkspace,
  writeProjectExtension,
} from "../helpers/electron-app";

const extensionSource = String.raw`
export default function pendingExtension(pi) {
  pi.registerCommand("dialog-confirm", {
    description: "Open a confirmation dialog",
    handler: async (_args, ctx) => {
      await ctx.ui.confirm("Confirm change?", "Approve this change.");
    },
  });
}
`;

test("a session waiting on a dialog is marked in the sidebar", async ({}, testInfo) => {
  test.setTimeout(90_000);
  const userDataDir = await makeUserDataDir();
  const workspacePath = await makeWorkspace("pending-approval-workspace");
  await writeProjectExtension(workspacePath, "pending-extension.ts", extensionSource);

  const harness = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();
    await createNamedThread(window, "Waiting session");

    const badge = window.getByTestId("session-pending-approval");
    await expect(badge).toHaveCount(0);

    const composer = window.getByTestId("composer");
    await composer.fill("/dialog-confirm ");
    await composer.press("Enter");

    const dialog = window.getByTestId("extension-dialog");
    await expect(dialog).toBeVisible();
    // The row is the only place that says a dialog is waiting while another thread is open.
    await expect(badge).toHaveCount(1);
    await expect(badge).toHaveText(/待确认|Awaiting you/);

    await window.screenshot({ path: testInfo.outputPath("pending-approval.png"), scale: "css" });

    await dialog.getByTestId("extension-dialog-cancel").click();
    await expect(dialog).toHaveCount(0);
    await expect(badge).toHaveCount(0);
  } finally {
    await harness.close();
  }
});
