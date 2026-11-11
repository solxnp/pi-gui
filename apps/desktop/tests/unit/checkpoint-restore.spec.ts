import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { applyTurnRestore, previewTurnRestore } from "../../electron/workbench/checkpoint-restore";

function runGit(args: string[], options: { env?: NodeJS.ProcessEnv; input?: string } = {}) {
  return new Promise<string>((done, fail) => {
    const child = execFile(
      "git",
      args,
      {
        env: { ...process.env, ...options.env },
        encoding: "utf8",
        maxBuffer: 16 * 1024 * 1024,
      },
      (error, stdout, stderr) => {
        if (error) {
          fail(new Error(stderr.trim() || error.message));
          return;
        }
        done(stdout);
      },
    );
    child.stdin?.end(options.input ?? "");
  });
}

const GIT_ENV: NodeJS.ProcessEnv = {
  GIT_AUTHOR_NAME: "test",
  GIT_AUTHOR_EMAIL: "test@example.com",
  GIT_COMMITTER_NAME: "test",
  GIT_COMMITTER_EMAIL: "test@example.com",
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_SYSTEM: "/dev/null",
};

interface Fixture {
  readonly root: string;
  readonly repositoryPath: string;
  readonly checkoutPath: string;
  readonly indexPath: string;
}

async function createFixture(): Promise<Fixture> {
  const root = await mkdtemp(join(tmpdir(), "pi-gui-rewind-"));
  const repositoryPath = join(root, "objects.git");
  const checkoutPath = join(root, "checkout");
  const indexPath = join(root, "index");
  await mkdir(checkoutPath, { recursive: true });
  await runGit(["init", "--bare", "-q", repositoryPath], { env: GIT_ENV });
  return { root, repositoryPath, checkoutPath, indexPath };
}

/** Builds a snapshot tree in the app's store from a path→content map. */
async function writeTree(fixture: Fixture, files: Record<string, string>): Promise<string> {
  const index = { GIT_INDEX_FILE: fixture.indexPath };
  await runGit(["--git-dir", fixture.repositoryPath, "read-tree", "--empty"], {
    env: { ...GIT_ENV, ...index },
  });
  for (const [path, content] of Object.entries(files)) {
    const oid = (
      await runGit(["--git-dir", fixture.repositoryPath, "hash-object", "-w", "--stdin"], {
        env: GIT_ENV,
        input: content,
      })
    ).trim();
    await runGit(
      [
        "--git-dir",
        fixture.repositoryPath,
        "update-index",
        "--add",
        "--cacheinfo",
        `100644,${oid},${path}`,
      ],
      { env: { ...GIT_ENV, ...index } },
    );
  }
  return (
    await runGit(["--git-dir", fixture.repositoryPath, "write-tree"], {
      env: { ...GIT_ENV, ...index },
    })
  ).trim();
}

async function withFixture(run: (fixture: Fixture) => Promise<void>): Promise<void> {
  const fixture = await createFixture();
  try {
    await run(fixture);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
}

async function readCheckoutFile(fixture: Fixture, path: string): Promise<string | undefined> {
  try {
    return await readFile(join(fixture.checkoutPath, path), "utf8");
  } catch {
    return undefined;
  }
}

async function writeCheckoutFile(fixture: Fixture, path: string, content: string): Promise<void> {
  const absolute = join(fixture.checkoutPath, path);
  await mkdir(join(absolute, ".."), { recursive: true });
  await writeFile(absolute, content, "utf8");
}

test("restoring a turn rewrites its files and removes the ones it created", async () => {
  await withFixture(async (fixture) => {
    const before = await writeTree(fixture, { "a.txt": "one\n", "b.txt": "two\n" });
    const after = await writeTree(fixture, { "a.txt": "one changed\n", "c.txt": "new\n" });

    // What the turn left on disk, plus a file the turn never touched.
    await writeCheckoutFile(fixture, "a.txt", "one changed\n");
    await writeCheckoutFile(fixture, "c.txt", "new\n");
    await writeCheckoutFile(fixture, "mine.txt", "user file\n");

    const result = await applyTurnRestore({
      repositoryPath: fixture.repositoryPath,
      checkoutPath: fixture.checkoutPath,
      beforeTreeOid: before,
      afterTreeOid: after,
    });

    expect(result.failure).toBeUndefined();
    expect(result.restored).toEqual(["a.txt", "b.txt"]);
    expect(result.removed).toEqual(["c.txt"]);

    expect(await readCheckoutFile(fixture, "a.txt")).toBe("one\n");
    expect(await readCheckoutFile(fixture, "b.txt")).toBe("two\n");
    expect(await readCheckoutFile(fixture, "c.txt")).toBeUndefined();
    // Untouched files survive: the restore is scoped to the turn.
    expect(await readCheckoutFile(fixture, "mine.txt")).toBe("user file\n");
  });
});

test("the preview lists the same work without touching the checkout", async () => {
  await withFixture(async (fixture) => {
    const before = await writeTree(fixture, { "a.txt": "one\n", "b.txt": "two\n" });
    const after = await writeTree(fixture, { "a.txt": "one changed\n", "c.txt": "new\n" });
    await writeCheckoutFile(fixture, "a.txt", "one changed\n");
    await writeCheckoutFile(fixture, "c.txt", "new\n");

    const preview = await previewTurnRestore({
      repositoryPath: fixture.repositoryPath,
      checkoutPath: fixture.checkoutPath,
      beforeTreeOid: before,
      afterTreeOid: after,
    });

    expect(preview.failure).toBeUndefined();
    expect(preview.entries.map((entry) => [entry.path, entry.change])).toEqual([
      ["a.txt", "restore"],
      ["b.txt", "restore"],
      ["c.txt", "remove"],
    ]);
    expect(preview.entries[0]?.additions).toBe(1);
    expect(preview.entries[0]?.deletions).toBe(1);

    // Nothing was written by the preview itself.
    expect(await readCheckoutFile(fixture, "a.txt")).toBe("one changed\n");
    expect(await readCheckoutFile(fixture, "b.txt")).toBeUndefined();
  });
});

test("a missing checkout or an unreadable store refuses instead of writing", async () => {
  await withFixture(async (fixture) => {
    const before = await writeTree(fixture, { "a.txt": "one\n" });
    const after = await writeTree(fixture, { "a.txt": "two\n" });

    const missingCheckout = await applyTurnRestore({
      repositoryPath: fixture.repositoryPath,
      checkoutPath: join(fixture.root, "gone"),
      beforeTreeOid: before,
      afterTreeOid: after,
    });
    expect(missingCheckout.failure?.code).toBe("checkout-mismatch");
    expect(missingCheckout.restored).toEqual([]);

    const badTree = await applyTurnRestore({
      repositoryPath: fixture.repositoryPath,
      checkoutPath: fixture.checkoutPath,
      beforeTreeOid: "0".repeat(40),
      afterTreeOid: "0".repeat(40),
    });
    expect(badTree.failure?.code).toBe("storage-unavailable");

    const malformed = await applyTurnRestore({
      repositoryPath: fixture.repositoryPath,
      checkoutPath: fixture.checkoutPath,
      beforeTreeOid: "not-a-tree",
      afterTreeOid: after,
    });
    expect(malformed.failure?.code).toBe("storage-unavailable");
  });
});

test("a turn that changed nothing restores nothing", async () => {
  await withFixture(async (fixture) => {
    const tree = await writeTree(fixture, { "a.txt": "one\n" });
    await writeCheckoutFile(fixture, "a.txt", "one\n");

    const preview = await previewTurnRestore({
      repositoryPath: fixture.repositoryPath,
      checkoutPath: fixture.checkoutPath,
      beforeTreeOid: tree,
      afterTreeOid: tree,
    });
    expect(preview.entries).toEqual([]);

    const result = await applyTurnRestore({
      repositoryPath: fixture.repositoryPath,
      checkoutPath: fixture.checkoutPath,
      beforeTreeOid: tree,
      afterTreeOid: tree,
    });
    expect(result.restored).toEqual([]);
    expect(result.removed).toEqual([]);
    expect(result.failure).toBeUndefined();
    await expect(stat(join(fixture.checkoutPath, "a.txt"))).resolves.toBeTruthy();
  });
});
