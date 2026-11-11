import type { DesktopAppState } from "../../../contracts/desktop-state";

/**
 * Session keys whose extension UI still holds a dialog the user has to answer. The sidebar uses it
 * to mark a row, so a dialog in a thread the user is not looking at cannot go unnoticed.
 */
export function pendingApprovalSessionKeys(
  bySession: DesktopAppState["sessionExtensionUiBySession"] | undefined,
): ReadonlySet<string> {
  const keys = new Set<string>();
  if (!bySession) {
    return keys;
  }
  for (const [key, ui] of Object.entries(bySession)) {
    if (ui.pendingDialogs.length > 0) {
      keys.add(key);
    }
  }
  return keys;
}
