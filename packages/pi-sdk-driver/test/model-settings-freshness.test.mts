import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRuntimeDependencies } from "../dist/runtime-deps.js";
import { RuntimeSupervisor } from "../dist/runtime-supervisor.js";

const OLD_MODEL = "minimax/minimax-m3.1-flash";
const NEW_MODEL = "deepseek/deepseek-v4.1-flash";

interface Fixture {
  readonly supervisor: RuntimeSupervisor;
  readonly settingsPath: string;
  readonly first: { workspaceId: string; path: string; displayName: string };
  readonly second: { workspaceId: string; path: string; displayName: string };
}

async function makeFixture(): Promise<Fixture> {
  const root = await mkdtemp(join(tmpdir(), "pi-gui-model-settings-"));
  const agentDir = join(root, "agent");
  await mkdir(agentDir, { recursive: true });
  const settingsPath = join(agentDir, "settings.json");
  await writeFile(
    settingsPath,
    `${JSON.stringify({ defaultProvider: "commandcode", defaultModel: OLD_MODEL }, null, 2)}\n`,
    "utf8",
  );
  const paths = await Promise.all(
    ["first", "second"].map(async (name) => {
      const path = join(root, name);
      await mkdir(join(path, ".pi"), { recursive: true });
      return { workspaceId: name, path, displayName: name };
    }),
  );
  const [first, second] = paths as [Fixture["first"], Fixture["second"]];
  const supervisor = new RuntimeSupervisor({ ...createRuntimeDependencies({ agentDir }) });
  return { supervisor, settingsPath, first, second };
}

await test("a default written through one workspace is visible from another", async () => {
  const { supervisor, first, second } = await makeFixture();

  // Load the second workspace's context first: it caches the global settings it read.
  assert.equal((await supervisor.getGlobalModelSettings(second)).defaultModelId, OLD_MODEL);

  // Settings → Models writes through whichever workspace is current in settings.
  await supervisor.setDefaultModel(first, { provider: "commandcode", modelId: NEW_MODEL });

  // Reading through the other workspace must not report the pre-write default, or the
  // settings page shows the old model again and New thread starts with it.
  assert.equal((await supervisor.getGlobalModelSettings(second)).defaultModelId, NEW_MODEL);
  assert.equal((await supervisor.getGlobalModelSettings(first)).defaultModelId, NEW_MODEL);
});

await test("an external edit to the global settings reaches a loaded workspace", async () => {
  const { supervisor, settingsPath, second } = await makeFixture();

  assert.equal((await supervisor.getGlobalModelSettings(second)).defaultModelId, OLD_MODEL);
  await writeFile(
    settingsPath,
    `${JSON.stringify({ defaultProvider: "commandcode", defaultModel: NEW_MODEL }, null, 2)}\n`,
    "utf8",
  );

  assert.equal((await supervisor.getGlobalModelSettings(second)).defaultModelId, NEW_MODEL);
});
