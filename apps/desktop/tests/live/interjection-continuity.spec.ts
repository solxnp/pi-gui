import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import {
  desktopShortcut,
  getDesktopState,
  getRealAuthConfig,
  getSelectedTranscript,
  launchDesktop,
  makeUserDataDir,
  makeWorkspace,
  openNewThread,
} from "../helpers/electron-app";

/**
 * The live profile is the user's real agent directory, not pi's built-ins: a custom provider only
 * exists as an extension under `extensions/`, and its catalog only exists in `models-store.json`.
 * Both are copied when named, so this spec never guesses which provider a machine has.
 */
async function seedAgentDir(
  agentDir: string,
  sourceDir: string,
  providerExtension: string | undefined,
): Promise<void> {
  await mkdir(join(agentDir, "extensions"), { recursive: true });
  for (const fileName of ["auth.json", "settings.json", "models.json", "models-store.json"]) {
    const source = join(sourceDir, fileName);
    if (existsSync(source)) {
      await copyFile(source, join(agentDir, fileName));
    }
  }
  if (providerExtension) {
    await copyFile(
      join(sourceDir, "extensions", providerExtension),
      join(agentDir, "extensions", providerExtension),
    );
  }
}

async function pinDefaultModel(agentDir: string, provider: string, modelId: string): Promise<void> {
  const settingsPath = join(agentDir, "settings.json");
  const settings = existsSync(settingsPath)
    ? (JSON.parse(await readFile(settingsPath, "utf8")) as Record<string, unknown>)
    : {};
  await writeFile(
    settingsPath,
    `${JSON.stringify(
      { ...settings, defaultProvider: provider, defaultModel: modelId },
      null,
      2,
    )}\n`,
  );
}

/**
 * A prompt typed while a run is going must not end the run, and must not leak its model-facing
 * block into the transcript.
 *
 * What this proves: the steer is delivered with the block, the run keeps working after it, the row
 * is labelled, and the transcript never shows the instructions. What it does not prove: that the
 * block is what made the model continue — a prompt that already spells out the remaining work can
 * carry the model through it either way (measured: it does, with the block removed). The
 * directive's own effect is only visible when a model decides to end the run, which no fixed prompt
 * can force; the guard test below covers the case where that happens.
 */
test("a mid-run interjection is labelled and the run continues afterwards", async () => {
  test.setTimeout(300_000);
  const realAuth = getRealAuthConfig();
  test.skip(!realAuth.enabled, realAuth.skipReason);
  const sourceDir = realAuth.sourceDir as string;

  const provider = process.env.PI_GUI_PROVIDER?.trim() || "commandcode";
  const model = process.env.PI_GUI_MODEL?.trim() || "deepseek/deepseek-v4.1-flash";
  const providerExtension = process.env.PI_GUI_PROVIDER_EXTENSION?.trim() || undefined;

  const userDataDir = await makeUserDataDir();
  const agentDir = join(userDataDir, "agent");
  await seedAgentDir(agentDir, sourceDir, providerExtension);
  await pinDefaultModel(agentDir, provider, model);

  const workspacePath = await makeWorkspace("interjection-continuity");
  const markerPath = join(workspacePath, "step-two.txt");
  const harness = await launchDesktop(userDataDir, {
    agentDir,
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();
    await openNewThread(window);
    await window
      .getByLabel("New thread prompt")
      .fill(
        [
          "Do this in exactly two tool calls, one after the other.",
          "First call: run `python3 - <<'PY'` with `import time`, `print('STEP-ONE')`, `time.sleep(25)`.",
          "Second call, only after the first finishes: run `python3 -c \"open('step-two.txt','w').write('STEP-TWO')\"`.",
          "After both calls, reply with exactly ALL_STEPS_DONE.",
        ].join("\n"),
      );
    await window.getByRole("button", { name: "Start thread" }).click();

    await expect(window.locator(".timeline-tool").first()).toBeVisible({ timeout: 120_000 });
    await expect
      .poll(
        async () => {
          const state = await getDesktopState(window);
          return state.workspaces[0]?.sessions[0]?.status ?? "";
        },
        { timeout: 120_000 },
      )
      .toBe("running");

    const composer = window.getByTestId("composer");
    await composer.fill("By the way, what is 2+2? Just the number.");
    await composer.press(desktopShortcut("Enter"));

    // The row says it arrived mid-run, so work that follows it is not mistaken for a new turn.
    const interjectionRow = window.getByTestId("message-interjection");
    await expect(interjectionRow).toHaveCount(1, { timeout: 60_000 });
    await expect(interjectionRow).toHaveText("Added mid-run");
    // Kept on disk so a person can check the label without re-running the whole flow.
    await window
      .locator(".timeline-item--user")
      .last()
      .screenshot({ path: test.info().outputPath("interjection-row.png") });

    // The proof it kept working: the second call's file, written after the question arrived.
    await expect.poll(() => existsSync(markerPath), { timeout: 240_000 }).toBe(true);

    await expect(
      window.locator(".timeline-item--assistant .message__content").last(),
    ).toContainText("ALL_STEPS_DONE", { timeout: 180_000 });

    const transcript = await getSelectedTranscript(window);
    const userRows = (transcript?.transcript ?? []).filter(
      (item) => item.kind === "message" && item.role === "user",
    );
    const interjection = userRows.at(-1);
    expect(interjection && "interjection" in interjection ? interjection.interjection : false).toBe(
      true,
    );
    // Instructions the model needs must never leak into the transcript.
    expect(interjection && "text" in interjection ? interjection.text : "").toBe(
      "By the way, what is 2+2? Just the number.",
    );
    await expect(window.getByTestId("transcript")).not.toContainText("pi-gui-interjection");
  } finally {
    await harness.close();
  }
});

/**
 * The guard: a model that ends its run while the plan still lists unfinished work gets one more
 * turn. The prompt asks it to stop half-way, so without `agent_before_settle` the file never
 * appears; with it, the next turn picks the pending step up.
 */
test("a run that stops with an unfinished plan is extended once", async () => {
  test.setTimeout(300_000);
  const realAuth = getRealAuthConfig();
  test.skip(!realAuth.enabled, realAuth.skipReason);
  const sourceDir = realAuth.sourceDir as string;

  const provider = process.env.PI_GUI_PROVIDER?.trim() || "commandcode";
  const model = process.env.PI_GUI_MODEL?.trim() || "deepseek/deepseek-v4.1-flash";
  const providerExtension = process.env.PI_GUI_PROVIDER_EXTENSION?.trim() || undefined;

  const userDataDir = await makeUserDataDir();
  const agentDir = join(userDataDir, "agent");
  await seedAgentDir(agentDir, sourceDir, providerExtension);
  await pinDefaultModel(agentDir, provider, model);

  const workspacePath = await makeWorkspace("interjection-guard");
  const markerPath = join(workspacePath, "guard-step.txt");
  const harness = await launchDesktop(userDataDir, {
    agentDir,
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();
    await openNewThread(window);
    await window
      .getByLabel("New thread prompt")
      .fill(
        [
          "Do exactly this, in order:",
          '1. Call update_plan with two steps: "准备" status done, "写入 guard-step.txt" status pending.',
          "2. Reply with exactly PAUSING_HERE and stop. Do not create any file yet.",
        ].join("\n"),
      );
    await window.getByRole("button", { name: "Start thread" }).click();

    await expect(window.getByTestId("pinned-cards"))
      .toContainText("PAUSING_HERE", {
        timeout: 1,
      })
      .catch(() => {});
    await expect(window.getByTestId("transcript")).toContainText("PAUSING_HERE", {
      timeout: 180_000,
    });

    await expect.poll(() => existsSync(markerPath), { timeout: 240_000 }).toBe(true);

    const fileText = await readFile(markerPath, "utf8");
    expect(fileText.length).toBeGreaterThan(0);
  } finally {
    await harness.close();
  }
});
