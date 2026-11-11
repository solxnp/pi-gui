/*
 * The permission gate's rule table in the shape Settings lists it.
 *
 * Settings shows one row per category and, under a disclosure, the rules behind
 * each row. The reason sentences stay in the rule modules so the dialog and the
 * Settings page cannot drift; this module only flattens both tables and tags
 * each rule with where it came from.
 */

import type { PermissionRuleRecord } from "../../contracts/ipc";
import { listCommandRules } from "./dangerous-bash";
import { listPathRules } from "./sensitive-path";

export function listPermissionRules(): readonly PermissionRuleRecord[] {
  return [
    ...listCommandRules().map((rule) => ({ ...rule, source: "command" as const })),
    ...listPathRules().map((rule) => ({ ...rule, source: "path" as const })),
  ];
}
