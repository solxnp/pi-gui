import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { expect, test } from "@playwright/test";
import { launchDesktop, makeUserDataDir, makeWorkspace } from "../helpers/electron-app";

interface LiveConfig {
  readonly "//"?: string;
  readonly projects: ReadonlyArray<{
    readonly name: string;
    readonly path: string;
    readonly sessionDir?: string;
    readonly note?: string;
  }>;
}

/** `JSON.parse` is `any`; keep the cast in one place so the assertions stay typed. */
async function readConfig(path: string): Promise<LiveConfig> {
  const raw: unknown = JSON.parse(await readFile(path, "utf8"));
  return raw as LiveConfig;
}

/**
 * The settings page is now the only realistic way to add a project to `recall.json`, so this drives
 * the real dialog: the list loads from pi's agent directory, a bad path is refused without touching
 * the file, and a good save writes the entries back.
 */
test("recall projects are added, edited and deleted in settings", async ({}, testInfo) => {
  test.setTimeout(300_000);

  const userDataDir = await makeUserDataDir("pi-gui-recall-live-");
  const workspacePath = await makeWorkspace("recall-projects-workspace");
  const secondPath = await makeWorkspace("recall-projects-second");
  const agentDir = join(userDataDir, "agent");
  const configPath = join(agentDir, "recall.json");

  const harness = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();

    // Seed the file after launch so the app's own agent-directory seeding cannot overwrite it.
    await mkdir(join(agentDir, "sessions", "--seeded--"), { recursive: true });
    await writeFile(
      configPath,
      `${JSON.stringify(
        {
          "//": "seeded by the live test",
          projects: [
            { name: "seeded", path: workspacePath, sessionDir: "--seeded--", note: "已有项目" },
          ],
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    await window.getByRole("button", { name: /^(Settings|设置)$/ }).click();
    await window.getByRole("button", { name: /^(Recall projects|知识库项目)$/ }).click();

    await expect(window.getByTestId("recall-projects-path")).toHaveValue(/recall\.json$/, {
      timeout: 30_000,
    });
    await expect(window.getByText("seeded", { exact: true })).toBeVisible();

    // A path that does not exist is refused and the file keeps its previous contents.
    await window.getByTestId("recall-project-add").click();
    await window.getByTestId("recall-project-name").fill("broken");
    await window.getByTestId("recall-project-path-input").fill(join(secondPath, "nope"));
    await window.getByTestId("recall-project-save").click();
    await expect(window.getByTestId("recall-projects-problems")).toBeVisible();
    await expect(window.getByTestId("recall-project-dialog")).toBeVisible();
    expect((await readConfig(configPath)).projects).toHaveLength(1);
    await window.getByTestId("recall-project-cancel").click();
    await expect(window.getByTestId("recall-project-dialog")).toBeHidden();

    // A real folder saves, and the entry the test did not touch survives the rewrite.
    await window.getByTestId("recall-project-add").click();
    await window.getByTestId("recall-project-name").fill(basename(secondPath));
    await window.getByTestId("recall-project-path-input").fill(secondPath);
    await window.getByTestId("recall-project-note").fill("新增项目");
    await window.getByTestId("recall-project-save").click();
    await expect(window.getByTestId("recall-project-dialog")).toBeHidden();

    const afterAdd = await readConfig(configPath);
    expect(afterAdd["//"]).toBe("seeded by the live test");
    expect(afterAdd.projects).toEqual([
      { name: "seeded", path: workspacePath, sessionDir: "--seeded--", note: "已有项目" },
      { name: basename(secondPath), path: secondPath, note: "新增项目" },
    ]);
    await expect(window.getByText(basename(secondPath), { exact: true })).toBeVisible();
    await window.screenshot({
      path: testInfo.outputPath("recall-projects-settings.png"),
      scale: "css",
    });

    // Editing rewrites that row only.
    await window.getByTestId("recall-project-edit-1").click();
    await window.getByTestId("recall-project-note").fill("改过的备注");
    await window.getByTestId("recall-project-save").click();
    await expect(window.getByTestId("recall-project-dialog")).toBeHidden();
    expect((await readConfig(configPath)).projects[1]?.note).toBe("改过的备注");

    // Deleting asks first, then drops exactly one entry.
    await window.getByTestId("recall-project-delete-1").click();
    await expect(window.getByTestId("recall-project-delete-dialog")).toBeVisible();
    await window.getByTestId("recall-project-delete-confirm").click();
    await expect(window.getByTestId("recall-project-delete-dialog")).toBeHidden();

    const afterDelete = await readConfig(configPath);
    expect(afterDelete.projects.map((project) => project.name)).toEqual(["seeded"]);
  } finally {
    await harness.close();
    await rm(secondPath, { recursive: true, force: true });
  }
});
