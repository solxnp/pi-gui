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

/** A dialog shows the first lines of the command; the full text stays in the transcript's tool card. */
const COMMAND_PREVIEW_LINES = 4;
const COMMAND_PREVIEW_CHARS = 320;

type FileOperation = "read" | "write" | "edit";

const FILE_OPERATION_LABEL: Readonly<Record<FileOperation, string>> = {
  read: "读取",
  write: "写入",
  edit: "编辑",
};

function previewCommand(command: string): string {
  const lines = command.replace(/\r\n/g, "\n").trimEnd().split("\n");
  const shown = lines.slice(0, COMMAND_PREVIEW_LINES);
  const text = shown.join("\n");
  const clipped =
    text.length <= COMMAND_PREVIEW_CHARS ? text : `${text.slice(0, COMMAND_PREVIEW_CHARS)}…`;
  const hidden = lines.length - shown.length;
  return hidden > 0 ? `${clipped}\n…（共 ${lines.length} 行，完整命令见对话里的工具卡）` : clipped;
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
      reason: `这条命令被判为危险，但没有可用的确认对话框，已拦下（规则：${ids}）。`,
    };
  }

  const message = [
    "【要执行的命令】",
    previewCommand(command),
    "",
    "【为什么先问你】",
    ...matches.map((match) => `· ${match.reason}`),
    "",
    "Confirm = 放行这一次　　Cancel = 拦下，AI 会收到你的拒绝",
  ].join("\n");

  const allowed = await askUser(ctx, "要执行这条命令，确认吗？", message);
  return allowed ? undefined : { block: true, reason: `用户拒绝了这条危险命令（规则：${ids}）。` };
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
      reason: `要${label}一个存凭据的文件，但没有可用的确认对话框，已拦下（${path}，规则：${ids}）。`,
    };
  }

  const message = [
    `【要做的事】${label}这个文件`,
    path,
    "",
    "【为什么先问你】",
    ...matches.map((match) => `· ${match.reason}`),
    "",
    `Confirm = 允许这一次　　Cancel = 拒绝`,
  ].join("\n");

  const allowed = await askUser(ctx, "要动一个存密码的文件，确认吗？", message);
  return allowed
    ? undefined
    : { block: true, reason: `用户拒绝了这次${label}敏感文件的请求（规则：${ids}）。` };
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
