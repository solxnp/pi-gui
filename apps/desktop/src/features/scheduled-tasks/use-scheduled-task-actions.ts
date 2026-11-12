import type { Dispatch, SetStateAction } from "react";
import type {
  CreateScheduledTaskInput,
  DesktopAppState,
  WorkspaceSessionTarget,
} from "../../../contracts/desktop-state";
import type { PiDesktopApi } from "../../../contracts/ipc";
import { updateSnapshot } from "../../app/desktop-app-state";
import type { ScheduledEditorState } from "./scheduled-task-editor";

interface ScheduledTaskActionsInput {
  readonly api: PiDesktopApi | undefined;
  readonly setSnapshot: Dispatch<SetStateAction<DesktopAppState | null>>;
  readonly scheduledEditor: ScheduledEditorState | null;
  readonly setScheduledEditor: (editor: ScheduledEditorState | null) => void;
  /** Opens the conversation a scheduled task points at. */
  readonly selectThread: (target: WorkspaceSessionTarget) => void;
}

/** The three writes the app makes on scheduled tasks, kept out of the shell. */
export function useScheduledTaskActions({
  api,
  setSnapshot,
  scheduledEditor,
  setScheduledEditor,
  selectThread,
}: ScheduledTaskActionsInput) {
  const createWithPi = () => {
    if (!api) return;
    void updateSnapshot(setSnapshot, () => api.beginScheduledTaskInterview()).catch(
      (error: unknown) => {
        console.error("[renderer] beginScheduledTaskInterview failed", error);
      },
    );
  };

  const submit = (input: CreateScheduledTaskInput) => {
    if (!api) return;
    const action =
      scheduledEditor?.mode === "edit"
        ? () => api.updateScheduledTask(scheduledEditor.taskId, input)
        : () => api.createScheduledTask(input);
    void updateSnapshot(setSnapshot, action)
      .then((state) => {
        if (!state.lastError) setScheduledEditor(null);
      })
      .catch((error: unknown) => {
        console.error("[renderer] save scheduled task failed", error);
      });
  };

  const openChat = (target: WorkspaceSessionTarget) => {
    setScheduledEditor(null);
    selectThread(target);
  };

  return { createWithPi, submit, openChat };
}
