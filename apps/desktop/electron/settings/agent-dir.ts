import { homedir } from "node:os";
import { join } from "node:path";

/**
 * pi's user-level directory (`~/.pi/agent`), honoring the same `PI_CODING_AGENT_DIR` override pi
 * itself reads. Kept in one place so the settings file, the `recall` config and extensions can
 * never disagree about where the agent directory is.
 */
export function resolvePiAgentDir(): string {
  const override = process.env.PI_CODING_AGENT_DIR;
  if (!override) {
    return join(homedir(), ".pi", "agent");
  }
  return override.startsWith("~") ? join(homedir(), override.slice(1)) : override;
}
