import { execFile } from "node:child_process";
import { readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import {
  createNamedThread,
  getRealAuthConfig,
  launchDesktop,
  makeUserDataDir,
  makeWorkspace,
} from "../helpers/electron-app";

/** Turn capture only exists for a checkout Git can see, so the scratch workspace has to be a repo. */
function runGit(args: string[], cwd: string): Promise<void> {
  return new Promise((done, fail) => {
    execFile(
      "git",
      [
        "-c",
        "user.email=test@example.com",
        "-c",
        "user.name=test",
        "-c",
        "commit.gpgsign=false",
        ...args,
      ],
      { cwd },
      (error, _stdout, stderr) => {
        if (error) {
          fail(new Error(stderr.trim() || error.message));
          return;
        }
        done();
      },
    );
  });
}

async function fileOf(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf8");
  } catch {
    return undefined;
  }
}

/**
 * A rewind is only real if the file on disk goes back. This drives the whole path: a model turn that
 * creates a file, the card's rewind button, the confirmation, and the undo that follows.
 */
test("rewinding a turn restores the file on disk and can be undone", async ({}, testInfo) => {
  test.setTimeout(420_000);
  const realAuth = getRealAuthConfig();
  test.skip(!realAuth.enabled, realAuth.skipReason);

  const userDataDir = await makeUserDataDir("pi-gui-rewind-live-");
  const workspacePath = await makeWorkspace("rewind-workspace");
  const probePath = join(workspacePath, "rewind-probe.txt");
  await runGit(["init", "-q"], workspacePath);
  await writeFile(join(workspacePath, "README.md"), "seed\n", "utf8");
  await runGit(["add", "-A"], workspacePath);
  await runGit(["commit", "-qm", "seed"], workspacePath);

  const harness = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "background",
    realAuthSourceDir: realAuth.sourceDir,
  });

  try {
    const window = await harness.firstWindow();
    await createNamedThread(window, "Rewind");

    const composer = window.getByTestId("composer");
    await composer.fill(
      "Use the bash tool to run exactly: printf v1 > rewind-probe.txt\nThen reply with one short sentence and stop.",
    );
    await composer.press("Enter");

    await expect.poll(() => fileOf(probePath), { timeout: 180_000 }).toBe("v1");

    const card = window.getByTestId("turn-changes");
    await expect(card.first()).toBeVisible({ timeout: 120_000 });

    await card.first().getByTestId("turn-changes-rewind").click();
    const dialog = window.getByTestId("rewind-confirm");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByTestId("rewind-confirm-files")).toContainText("rewind-probe.txt");
    await window.screenshot({ path: testInfo.outputPath("rewind-confirm.png"), scale: "css" });

    await dialog.getByTestId("rewind-confirm-apply").click();
    await expect(dialog).toHaveCount(0);

    // The turn created the file, so rewinding removes it.
    await expect.poll(() => fileOf(probePath), { timeout: 30_000 }).toBeUndefined();
    await expect(card.first().getByTestId("turn-changes-rewound")).toBeVisible();

    await card.first().getByTestId("turn-changes-undo-rewind").click();
    await expect.poll(() => fileOf(probePath), { timeout: 30_000 }).toBe("v1");
    await expect
      .poll(async () => {
        try {
          await stat(probePath);
          return true;
        } catch {
          return false;
        }
      })
      .toBe(true);
  } finally {
    await harness.close();
  }
});
