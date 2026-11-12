import type { ComponentProps } from "react";
import type { PiDesktopApi } from "../../contracts/ipc";
import type { BuiltinToolKind } from "../../contracts/workbench";
import { renderBuiltinToolPanel } from "../features/workbench/builtin-tools";
import { DiffPanel } from "../features/workbench/diff-panel";
import { FileWorkbench } from "../features/workbench/file-workbench";
import { TasksBoardPanel } from "../features/workbench/tasks-board/tasks-board";
import { TerminalPanel } from "../features/workbench/terminal-panel";

type FilesPanelProps = Omit<ComponentProps<typeof FileWorkbench>, "workspace"> & {
  readonly workspace: ComponentProps<typeof FileWorkbench>["workspace"] | undefined;
};

interface WorkbenchToolPanelsProps {
  readonly tool: BuiltinToolKind;
  /** Remounts the panel when the thread changes, so per-thread state cannot leak. */
  readonly sessionKey: string;
  readonly api: PiDesktopApi | undefined;
  readonly tasks: ComponentProps<typeof TasksBoardPanel>;
  readonly changes: ComponentProps<typeof DiffPanel>;
  readonly files: FilesPanelProps;
  /** Optional: the terminal is docked under the window, not in the rail. */
  readonly terminal?: ComponentProps<typeof TerminalPanel>;
}

/** The composition root for built-in side panel tools, kept out of App's render body. */
export function WorkbenchToolPanels({
  tool,
  sessionKey,
  api,
  tasks,
  changes,
  files,
  terminal,
}: WorkbenchToolPanelsProps) {
  return renderBuiltinToolPanel(tool, {
    tasks: () =>
      api ? (
        <TasksBoardPanel key={sessionKey} {...tasks} />
      ) : (
        <p className="workbench__unavailable" role="status">
          This task list is unavailable.
        </p>
      ),
    changes: () => <DiffPanel key={sessionKey} {...changes} />,
    files: () =>
      files.workspace ? (
        <FileWorkbench key={sessionKey} {...files} workspace={files.workspace} />
      ) : (
        <p className="workbench__unavailable" role="status">
          This file checkout is unavailable.
        </p>
      ),
    // The terminal moved to the bottom bar; a saved layout that still points here
    // shows a note instead of an empty panel.
    terminal: () =>
      terminal ? (
        <TerminalPanel key={sessionKey} {...terminal} />
      ) : (
        <p className="workbench__unavailable" role="status">
          The terminal is docked at the bottom of the window.
        </p>
      ),
  });
}
