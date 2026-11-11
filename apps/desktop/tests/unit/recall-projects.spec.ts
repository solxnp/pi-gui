import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import {
  createRecallProjectsService,
  RecallProjectsRejected,
} from "../../electron/settings/recall-projects";

async function withTempDir(run: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "pi-gui-recall-"));
  try {
    await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function makeProject(dir: string, name = "demo"): Promise<string> {
  const path = join(dir, name);
  await mkdir(path, { recursive: true });
  return path;
}

test("a missing config reads as an empty list, not an error", async () => {
  await withTempDir(async (dir) => {
    const service = createRecallProjectsService(join(dir, "recall.json"));
    const snapshot = await service.read();

    expect(snapshot.projects).toEqual([]);
    expect(snapshot.problem).toBeUndefined();
    expect(snapshot.path.endsWith("recall.json")).toBe(true);
  });
});

test("an unparseable file is reported instead of silently showing nothing", async () => {
  await withTempDir(async (dir) => {
    const path = join(dir, "recall.json");
    await writeFile(path, "{ not json", "utf8");
    expect((await createRecallProjectsService(path).read()).problem).toBe("invalidJson");

    await writeFile(path, JSON.stringify({ projects: "nope" }), "utf8");
    expect((await createRecallProjectsService(path).read()).problem).toBe("invalidShape");
  });
});

test("saving keeps the list sorted as given and drops unknown entry fields", async () => {
  await withTempDir(async (dir) => {
    const service = createRecallProjectsService(join(dir, "recall.json"));
    const projectPath = await makeProject(dir);

    await service.save([
      { name: " demo ", path: ` ${projectPath} `, sessionDir: "", note: " 备注 " },
    ]);

    const written = JSON.parse(await readFile(join(dir, "recall.json"), "utf8")) as {
      projects: unknown[];
    };
    expect(written.projects).toEqual([{ name: "demo", path: projectPath, note: "备注" }]);
  });
});

test("saving keeps top-level keys the page does not own", async () => {
  await withTempDir(async (dir) => {
    const path = join(dir, "recall.json");
    const projectPath = await makeProject(dir);
    await writeFile(path, JSON.stringify({ "//": "hand written", future: { a: 1 } }), "utf8");

    await createRecallProjectsService(path).save([{ name: "demo", path: projectPath }]);

    const written = JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
    expect(written["//"]).toBe("hand written");
    expect(written.future).toEqual({ a: 1 });
    expect(written.projects).toHaveLength(1);
  });
});

test("saving over an unparseable file leaves a .bak behind", async () => {
  await withTempDir(async (dir) => {
    const path = join(dir, "recall.json");
    const projectPath = await makeProject(dir);
    await writeFile(path, "{ broken", "utf8");

    await createRecallProjectsService(path).save([{ name: "demo", path: projectPath }]);

    expect(await readFile(`${path}.bak`, "utf8")).toBe("{ broken");
  });
});

test("a path that does not exist is rejected, and nothing is written", async () => {
  await withTempDir(async (dir) => {
    const path = join(dir, "recall.json");
    const service = createRecallProjectsService(path);

    await expect(
      service.save([{ name: "demo", path: join(dir, "missing") }]),
    ).rejects.toBeInstanceOf(RecallProjectsRejected);
    await expect(readFile(path, "utf8")).rejects.toThrow();
  });
});

test("entries are checked one by one so the page can point at the bad row", async () => {
  await withTempDir(async (dir) => {
    const service = createRecallProjectsService(join(dir, "recall.json"));
    const projectPath = await makeProject(dir);
    const filePath = join(dir, "a-file");
    await writeFile(filePath, "", "utf8");

    const rejected = await service
      .save([
        { name: "", path: projectPath },
        { name: "demo", path: "relative/path" },
        { name: "demo", path: projectPath },
        { name: "file", path: filePath },
        { name: "slash", path: projectPath, sessionDir: "a/b" },
        { name: "absent", path: projectPath, sessionDir: "--not-there--" },
        "not an object",
      ])
      .catch((error: unknown) => error);

    expect(rejected).toBeInstanceOf(RecallProjectsRejected);
    const problems = rejected instanceof RecallProjectsRejected ? rejected.problems : [];
    expect(problems.map((problem) => problem.code)).toEqual([
      "nameEmpty",
      "pathNotAbsolute",
      "nameDuplicate",
      "pathNotDirectory",
      "sessionDirInvalid",
      "sessionDirMissing",
      "notAnObject",
    ]);
    expect(problems.map((problem) => problem.index)).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });
});

test("a session folder must exist under sessions/ next to the config", async () => {
  await withTempDir(async (dir) => {
    const service = createRecallProjectsService(join(dir, "recall.json"));
    const projectPath = await makeProject(dir);
    await mkdir(join(dir, "sessions", "--demo--"), { recursive: true });

    const snapshot = await service.save([
      { name: "demo", path: projectPath, sessionDir: "--demo--" },
    ]);

    expect(snapshot.projects).toEqual([
      { name: "demo", path: projectPath, sessionDir: "--demo--" },
    ]);
  });
});
