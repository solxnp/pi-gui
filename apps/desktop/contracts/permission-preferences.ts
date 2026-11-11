/*
 * Which kinds of tool calls pi-gui asks about before letting them run.
 *
 * The permission gate used to be all-or-nothing. These categories are the
 * granularity the Settings page exposes: each one owns a set of concrete rules
 * (rule ids live with the rules themselves, in `electron/permissions/`), and a
 * rule that belongs to a switched-off category no longer opens the dialog.
 *
 * Recipe defaults keep every dangerous action gated except access to credentials
 * files through a command line, which is the noisiest rule set and the one a
 * user asked to silence. Unknown rule ids stay gated: the failure direction is a
 * dialog, never a silent pass.
 */

export const permissionCategoryIds = [
  "delete-disk",
  "sudo",
  "file-mode",
  "git",
  "remote-script",
  "containers",
  "system-services",
  "credential-files",
  "credential-commands",
] as const;

export type PermissionCategoryId = (typeof permissionCategoryIds)[number];

export interface PermissionPreferences {
  /** The master switch; false means no dialog ever opens. */
  readonly enabled: boolean;
  readonly categories: Readonly<Record<PermissionCategoryId, boolean>>;
}

export interface PermissionPreferencesPatch {
  readonly enabled?: boolean;
  readonly categories?: Partial<Record<PermissionCategoryId, boolean>>;
}

export function isPermissionCategoryId(value: unknown): value is PermissionCategoryId {
  return typeof value === "string" && permissionCategoryIds.includes(value as PermissionCategoryId);
}

/** Every category on: what the gate falls back to when its settings cannot be read. */
export function createStrictPermissionPreferences(): PermissionPreferences {
  return {
    enabled: true,
    categories: {
      "delete-disk": true,
      sudo: true,
      "file-mode": true,
      git: true,
      "remote-script": true,
      containers: true,
      "system-services": true,
      "credential-files": true,
      "credential-commands": true,
    },
  };
}

/** Copy-on-read, so a caller cannot mutate the shared default. */
export function createDefaultPermissionPreferences(): PermissionPreferences {
  return {
    enabled: true,
    categories: {
      "delete-disk": true,
      sudo: true,
      "file-mode": true,
      git: true,
      "remote-script": true,
      containers: true,
      "system-services": true,
      "credential-files": true,
      "credential-commands": false,
    },
  };
}

/**
 * Applies a patch from Settings. Unknown category keys are dropped rather than
 * guessed at, so an older build cannot silently turn a new category on or off.
 */
export function applyPermissionPreferencesPatch(
  current: PermissionPreferences,
  patch: PermissionPreferencesPatch,
): PermissionPreferences {
  const categories = { ...current.categories };
  for (const [key, value] of Object.entries(patch.categories ?? {})) {
    if (isPermissionCategoryId(key) && typeof value === "boolean") {
      categories[key] = value;
    }
  }
  return {
    enabled: typeof patch.enabled === "boolean" ? patch.enabled : current.enabled,
    categories,
  };
}

export function isPermissionCategoryEnabled(
  preferences: PermissionPreferences,
  category: PermissionCategoryId,
): boolean {
  return preferences.categories[category] === true;
}
