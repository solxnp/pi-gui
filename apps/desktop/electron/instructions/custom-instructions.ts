/**
 * User-level instructions for every run in pi-gui.
 *
 * The file lives next to the app's other local settings (`<userData>/custom-instructions.md`) and is
 * read again before every run, so an edit applies to the next message without a restart. It is
 * appended to the system prompt as a separate block, which keeps a project's `AGENTS.md` and these
 * instructions distinguishable in a transcript.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionFactory } from "@earendil-works/pi-coding-agent";

export const customInstructionsFileName = "custom-instructions.md";

/** A pasted-in manual stops helping long before this; the block should stay a preference list. */
export const CUSTOM_INSTRUCTIONS_LIMIT = 8_000;

export function customInstructionsPath(userDataDir: string): string {
  return join(userDataDir, customInstructionsFileName);
}

export function readCustomInstructions(path: string): string | undefined {
  let raw: string;
  try {
    raw = readFileSync(path, "utf-8");
  } catch {
    return undefined;
  }
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return undefined;
  }
  return trimmed.slice(0, CUSTOM_INSTRUCTIONS_LIMIT);
}

export function withCustomInstructions(systemPrompt: string, instructions: string): string {
  return `${systemPrompt}\n\n<user_instructions>\n${instructions}\n</user_instructions>`;
}

export function createCustomInstructionsExtension(
  read: () => string | undefined,
): ExtensionFactory {
  return (pi: ExtensionAPI) => {
    pi.on("before_agent_start", async (event) => {
      const instructions = read();
      if (instructions === undefined) {
        return undefined;
      }
      return { systemPrompt: withCustomInstructions(event.systemPrompt, instructions) };
    });
  };
}
