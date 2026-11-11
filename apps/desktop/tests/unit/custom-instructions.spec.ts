import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
  createCustomInstructionsExtension,
  CUSTOM_INSTRUCTIONS_LIMIT,
  customInstructionsPath,
  readCustomInstructions,
  withCustomInstructions,
} from "../../electron/instructions/custom-instructions";

type BeforeAgentStartHandler = (
  event: { systemPrompt: string },
  ctx: ExtensionContext,
) => Promise<{ systemPrompt: string } | undefined>;

function registerExtension(read: () => string | undefined): Promise<BeforeAgentStartHandler> {
  let handler: BeforeAgentStartHandler | undefined;
  const pi = {
    on: (_event: string, next: BeforeAgentStartHandler) => {
      handler = next;
      return () => {};
    },
  } as unknown as ExtensionAPI;
  const registration = Promise.resolve(createCustomInstructionsExtension(read)(pi));

  return registration.then(() => {
    if (!handler) {
      throw new Error(
        "The custom-instructions extension did not register a before_agent_start handler.",
      );
    }
    return handler;
  });
}

async function withTempDir(run: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "pi-gui-instructions-"));
  try {
    await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("a missing or empty file contributes nothing", async () => {
  await withTempDir(async (dir) => {
    const path = customInstructionsPath(dir);
    expect(readCustomInstructions(path)).toBeUndefined();

    await writeFile(path, "   \n\n\t\n", "utf8");
    expect(readCustomInstructions(path)).toBeUndefined();
  });
});

test("instructions are trimmed and capped", async () => {
  await withTempDir(async (dir) => {
    const path = customInstructionsPath(dir);
    await writeFile(path, "\n  用中文回答。  \n", "utf8");
    expect(readCustomInstructions(path)).toBe("用中文回答。");

    await writeFile(path, "a".repeat(CUSTOM_INSTRUCTIONS_LIMIT + 500), "utf8");
    expect(readCustomInstructions(path)).toHaveLength(CUSTOM_INSTRUCTIONS_LIMIT);
  });
});

test("the instructions block is appended after the system prompt", () => {
  expect(withCustomInstructions("BASE", "RULE")).toBe(
    "BASE\n\n<user_instructions>\nRULE\n</user_instructions>",
  );
});

test("a run without instructions keeps the system prompt untouched", async () => {
  const handler = await registerExtension(() => undefined);
  expect(await handler({ systemPrompt: "BASE" }, {} as ExtensionContext)).toBeUndefined();
});

test("a run with instructions carries them in the system prompt", async () => {
  const handler = await registerExtension(() => "每次回复以 ZQ7 结尾");
  const result = await handler({ systemPrompt: "BASE" }, {} as ExtensionContext);

  expect(result?.systemPrompt).toContain("BASE");
  expect(result?.systemPrompt).toContain("<user_instructions>");
  expect(result?.systemPrompt).toContain("每次回复以 ZQ7 结尾");
});

test("each run reads the file again, so an edit needs no restart", async () => {
  await withTempDir(async (dir) => {
    const path = customInstructionsPath(dir);
    const handler = await registerExtension(() => readCustomInstructions(path));

    await writeFile(path, "第一版", "utf8");
    const first = await handler({ systemPrompt: "BASE" }, {} as ExtensionContext);
    expect(first?.systemPrompt).toContain("第一版");

    await writeFile(path, "第二版", "utf8");
    const second = await handler({ systemPrompt: "BASE" }, {} as ExtensionContext);
    expect(second?.systemPrompt).toContain("第二版");
    expect(second?.systemPrompt).not.toContain("第一版");
  });
});
