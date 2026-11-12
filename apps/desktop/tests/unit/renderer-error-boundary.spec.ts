import { expect, test } from "@playwright/test";
import {
  RendererErrorBoundary,
  rendererBoundaryCopy,
  startupSurfaceCopy,
} from "../../src/app/desktop-recovery";
import { catalogs } from "../../src/i18n";

const SENTINEL = "secret-token=/private/path";

test("startup copy switches on failure codes and never interpolates error text", () => {
  expect(startupSurfaceCopy({ kind: "loading" })).toEqual({
    titleKey: "startup.loading.title",
    bodyKey: "startup.loading.body",
    status: "loading",
  });
  expect(
    startupSurfaceCopy({
      kind: "failed",
      failure: { code: "state-request-failed" },
      retrying: false,
    }),
  ).toEqual({
    titleKey: "startup.failed.title",
    bodyKey: "startup.failed.body",
    status: "failed",
  });
  expect(
    startupSurfaceCopy({
      kind: "failed",
      failure: { code: "bridge-unavailable" },
      retrying: true,
    }).bodyKey,
  ).toBe("startup.bridgeFailed.body");
  expect(JSON.stringify(startupSurfaceCopy({ kind: "crashed" }))).not.toContain(SENTINEL);
});

test("error boundary derived state stores no thrown details", () => {
  const next = RendererErrorBoundary.getDerivedStateFromError(new Error(SENTINEL));
  expect(next).toEqual({ hasError: true });
  expect(JSON.stringify(next)).not.toContain("secret");
  expect(JSON.stringify(next)).not.toContain("/private/path");
});

test("crash fallback copy stays generic", () => {
  const copy = rendererBoundaryCopy();
  expect(copy.titleKey).toBe("startup.crashed.title");
  expect(copy.status).toBe("crashed");
  expect(JSON.stringify(copy)).not.toContain(SENTINEL);
});

test("the startup surface speaks both shipped languages", () => {
  // The crash and loading screens were the last hardcoded English in the shell, so every copy
  // key the surface can pick must exist in both packs.
  const keys = [
    startupSurfaceCopy({ kind: "loading" }).titleKey,
    startupSurfaceCopy({ kind: "loading" }).bodyKey,
    startupSurfaceCopy({ kind: "crashed" }).titleKey,
    startupSurfaceCopy({ kind: "crashed" }).bodyKey,
    startupSurfaceCopy({
      kind: "failed",
      failure: { code: "state-request-failed" },
      retrying: false,
    }).bodyKey,
    startupSurfaceCopy({
      kind: "failed",
      failure: { code: "bridge-unavailable" },
      retrying: false,
    }).bodyKey,
  ] as const;

  for (const locale of ["en", "zh-CN"] as const) {
    for (const key of keys) {
      expect(catalogs[locale][key], `${locale}:${key}`).toBeTruthy();
    }
  }
  expect(catalogs["zh-CN"]["startup.crashed.title"]).toBe("出了点问题");
  expect(catalogs["zh-CN"]["startup.retry"]).toBe("重试");
});
