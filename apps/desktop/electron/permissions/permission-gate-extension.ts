/**
 * pi-gui's built-in permission gate: asks before a dangerous bash command runs, and before a tool
 * reads or writes a file that holds credentials.
 *
 * A denial blocks the tool call, so the agent sees a failed tool result naming the rule instead of
 * silently continuing. A dialog that cannot be shown is treated as a refusal, never as approval.
 */

import type {
  ExtensionAPI,
  ExtensionContext,
  ExtensionFactory,
  ToolCallEvent,
  ToolCallEventResult,
} from "@earendil-works/pi-coding-agent";
import { findDangerousCommandMatches } from "./dangerous-bash";
import { findSensitivePathMatches } from "./sensitive-path";

export const permissionGateExtensionName = "pi-gui-permission-gate";

const COMMAND_PREVIEW_LIMIT = 400;

type FileOperation = "read" | "write" | "edit";

const FILE_OPERATION_LABEL: Readonly<Record<FileOperation, string>> = {
  read: "Read",
  write: "Write",
  edit: "Edit",
};

function preview(text: string, limit: number): string {
  return text.length <= limit ? text : `${text.slice(0, limit)}…`;
}

/**
 * Reads a string the tool takes by name. A custom tool shares the `toolName` space, so the input has
 * to be checked rather than trusted to be the built-in shape.
 */
function stringInput(event: ToolCallEvent, key: "command" | "path"): string | undefined {
  const value = (event.input as Record<string, unknown>)[key];
  return typeof value === "string" ? value : undefined;
}

/** A dialog that fails or is dismissed without an answer counts as a denial. */
async function askUser(ctx: ExtensionContext, title: string, message: string): Promise<boolean> {
  try {
    return await ctx.ui.confirm(title, message);
  } catch {
    return false;
  }
}

async function gateBashCommand(
  command: string,
  ctx: ExtensionContext,
): Promise<ToolCallEventResult | undefined> {
  const matches = findDangerousCommandMatches(command);
  if (matches.length === 0) {
    return undefined;
  }

  const ids = matches.map((match) => match.id).join(", ");
  if (!ctx.hasUI) {
    return {
      block: true,
      reason: `Dangerous bash command blocked without a confirmation dialog (${ids}).`,
    };
  }

  const message = [
    `${matches.length === 1 ? "1 rule" : `${matches.length} rules`} matched:`,
    "",
    ...matches.map((match) => `[${match.severity}] ${match.id} — ${match.reason}`),
    "",
    "Command:",
    preview(command, COMMAND_PREVIEW_LIMIT),
    "",
    "Deny skips this tool call.",
  ].join("\n");

  const allowed = await askUser(ctx, "Confirm dangerous command", message);
  return allowed
    ? undefined
    : { block: true, reason: `Dangerous bash command denied by the user (${ids}).` };
}

async function gateFilePath(
  operation: FileOperation,
  path: string,
  ctx: ExtensionContext,
): Promise<ToolCallEventResult | undefined> {
  const matches = findSensitivePathMatches(path);
  if (matches.length === 0) {
    return undefined;
  }

  const ids = matches.map((match) => match.id).join(", ");
  const label = FILE_OPERATION_LABEL[operation];
  if (!ctx.hasUI) {
    return {
      block: true,
      reason: `Sensitive file blocked without a confirmation dialog (${label.toLowerCase()} ${path}: ${ids}).`,
    };
  }

  const message = [
    `${label}: ${path}`,
    "",
    ...matches.map((match) => `[${match.id}] ${match.reason}`),
    "",
    `Allow this ${operation}?`,
  ].join("\n");

  const allowed = await askUser(ctx, "Confirm sensitive file access", message);
  return allowed
    ? undefined
    : { block: true, reason: `Sensitive file access denied by the user (${ids}).` };
}

export function createPermissionGateExtension(): ExtensionFactory {
  return (pi: ExtensionAPI) => {
    pi.on("tool_call", async (event, ctx) => {
      switch (event.toolName) {
        case "bash": {
          const command = stringInput(event, "command");
          return command === undefined ? undefined : gateBashCommand(command, ctx);
        }
        case "read":
        case "write":
        case "edit": {
          const path = stringInput(event, "path");
          return path === undefined ? undefined : gateFilePath(event.toolName, path, ctx);
        }
        default:
          return undefined;
      }
    });
  };
}
