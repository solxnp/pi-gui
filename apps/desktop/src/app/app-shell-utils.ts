import type { AppView } from "../../contracts/desktop-state";

export type ClosableSurface = "files" | "changes" | "terminal" | "workbench";

export function closableSurfaceFromTarget(target: EventTarget | null): ClosableSurface | null {
  if (!(target instanceof Element)) {
    return null;
  }
  if (target.closest("[data-pi-terminal]")) {
    return "terminal";
  }
  if (target.closest(".diff-panel")) {
    return "changes";
  }
  if (target.closest("[data-testid='file-workbench']")) {
    return "files";
  }
  if (target.closest("[data-testid='workbench']")) {
    return "workbench";
  }
  return null;
}

export function isEventInsideTerminal(event: globalThis.KeyboardEvent): boolean {
  return closableSurfaceFromTarget(event.target) === "terminal";
}

export function canTogglePrimarySidebar(view: AppView | undefined): boolean {
  return view === "threads" || view === "new-thread" || view === "scheduled";
}

/** The main pane's classes: the side panel and startup diagnostics widen or narrow it. */
export function mainPaneClassName(input: {
  readonly sidePanelVisible: boolean;
  readonly hasStartupDiagnostics: boolean;
}): string {
  return [
    "main",
    input.sidePanelVisible ? "main--with-side-panel" : "",
    input.hasStartupDiagnostics ? "main--with-startup-diagnostics" : "",
  ]
    .filter(Boolean)
    .join(" ");
}
