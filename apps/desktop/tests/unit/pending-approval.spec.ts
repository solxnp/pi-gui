import { expect, test } from "@playwright/test";
import type { DesktopAppState } from "../../contracts/desktop-state";
import { pendingApprovalSessionKeys } from "../../src/features/threads/pending-approval";

type BySession = DesktopAppState["sessionExtensionUiBySession"];

function sessionWith(dialogs: number) {
  return {
    instanceId: "instance",
    statuses: [],
    widgets: [],
    notices: [],
    pendingDialogs: Array.from({ length: dialogs }, (_, index) => ({
      kind: "confirm" as const,
      requestId: `request-${index}`,
      title: "Confirm change?",
      message: "Approve this change.",
    })),
  };
}

test("only the sessions holding a dialog are marked", () => {
  const bySession = {
    "ws:waiting": sessionWith(1),
    "ws:running": sessionWith(0),
  } as unknown as BySession;

  const keys = pendingApprovalSessionKeys(bySession);
  expect([...keys]).toEqual(["ws:waiting"]);
});

test("a session whose dialog was answered stops being marked", () => {
  const before = { "ws:waiting": sessionWith(1) } as unknown as BySession;
  const after = { "ws:waiting": sessionWith(0) } as unknown as BySession;

  expect(pendingApprovalSessionKeys(before).size).toBe(1);
  expect(pendingApprovalSessionKeys(after).size).toBe(0);
});

test("no extension UI at all means no marks", () => {
  expect(pendingApprovalSessionKeys(undefined).size).toBe(0);
  expect(pendingApprovalSessionKeys({} as BySession).size).toBe(0);
});
