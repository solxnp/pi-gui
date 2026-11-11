import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { createTasksBoardTask } from "../../electron/tasks/tasks-file";

test("a blank title is refused and leaves no file behind", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tasks-file-"));
  try {
    await expect(createTasksBoardTask(dir, "   ")).rejects.toThrow(/needs a title/);
    expect(await readdir(dir)).toEqual([]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
