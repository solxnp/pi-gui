import type { Dispatch, SetStateAction } from "react";
import type { DesktopAppState } from "../../contracts/desktop-state";
import type { PiDesktopApi } from "../../contracts/ipc";
import type { RuntimeSnapshot } from "@pi-gui/session-driver/runtime-types";
import { updateSnapshot } from "./desktop-app-state";

interface SessionModelActionsInput {
  readonly api: PiDesktopApi | undefined;
  readonly setSnapshot: Dispatch<SetStateAction<DesktopAppState | null>>;
  readonly workspaceId: string | undefined;
  readonly sessionId: string | undefined;
}

/** Writes the shown conversation's model and thinking level; no-ops without a thread. */
export function useSessionModelActions({
  api,
  setSnapshot,
  workspaceId,
  sessionId,
}: SessionModelActionsInput) {
  const run = (action: (client: PiDesktopApi) => Promise<DesktopAppState>) => {
    if (!api || !workspaceId || !sessionId) return;
    const client = api;
    void updateSnapshot(setSnapshot, () => action(client)).catch((error: unknown) => {
      console.error("[renderer] updateSnapshot failed", error);
    });
  };
  return {
    setModel: (provider: string, modelId: string) =>
      run((client) =>
        client.setSessionModel(workspaceId ?? "", sessionId ?? "", provider, modelId),
      ),
    setThinking: (level: string) =>
      run((client) =>
        client.setSessionThinkingLevel(
          workspaceId ?? "",
          sessionId ?? "",
          level as NonNullable<RuntimeSnapshot["settings"]["defaultThinkingLevel"]>,
        ),
      ),
  };
}
