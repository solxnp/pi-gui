import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import type { WorkspaceRecord } from "../../../contracts/desktop-state";
import { useTranslation } from "../../i18n";
import { TerminalPanel } from "./terminal-panel";

const STORAGE_KEY = "pi-gui.terminal-height";
const MIN_HEIGHT = 120;
const DEFAULT_HEIGHT = 280;

function maxHeight(): number {
  return Math.max(MIN_HEIGHT, Math.floor(window.innerHeight * 0.7));
}

function readHeight(): number {
  try {
    const raw = Number(localStorage.getItem(STORAGE_KEY));
    return Number.isFinite(raw) && raw >= MIN_HEIGHT ? Math.min(raw, maxHeight()) : DEFAULT_HEIGHT;
  } catch {
    return DEFAULT_HEIGHT;
  }
}

interface BottomTerminalProps {
  readonly open: boolean;
  readonly children: ReactNode;
}

/**
 * The integrated terminal, docked under the whole window like an editor's panel:
 * it spans both the transcript column and the side panel, and keeps its height
 * across launches so the layout the user dragged stays put.
 */
export function BottomTerminal({ open, children }: BottomTerminalProps) {
  const { t } = useTranslation();
  const [height, setHeight] = useState(readHeight);
  const drag = useRef<{ pointerId: number; startY: number; startHeight: number } | null>(null);

  useEffect(() => {
    if (!open) return;
    const clamp = () => setHeight((current) => Math.min(current, maxHeight()));
    window.addEventListener("resize", clamp);
    return () => window.removeEventListener("resize", clamp);
  }, [open]);

  const persist = useCallback((next: number) => {
    try {
      localStorage.setItem(STORAGE_KEY, String(Math.round(next)));
    } catch {
      // The drag still applies for this window when preferences cannot be saved.
    }
  }, []);

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { pointerId: event.pointerId, startY: event.clientY, startHeight: height };
  };
  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const state = drag.current;
    if (!state || state.pointerId !== event.pointerId) return;
    // Dragging up makes the panel taller, like the side panel's edge.
    const next = Math.min(
      maxHeight(),
      Math.max(MIN_HEIGHT, state.startHeight + (state.startY - event.clientY)),
    );
    setHeight(next);
  };
  const endDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    if (drag.current?.pointerId !== event.pointerId) return;
    drag.current = null;
    persist(height);
  };

  if (!open) return null;

  return (
    <section
      aria-label={t("terminal.panel")}
      className="bottom-terminal"
      data-testid="bottom-terminal"
      style={{ height }}
    >
      <div
        aria-label={t("terminal.resize")}
        aria-orientation="horizontal"
        className="bottom-terminal__handle"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        role="separator"
      />
      <div className="bottom-terminal__body">{children}</div>
    </section>
  );
}

/**
 * The dock plus the terminal it holds, so the shell only mounts one element and
 * the panel remounts with the conversation it belongs to.
 */
export function TerminalDock({
  open,
  workspace,
  sessionId,
  onHide,
}: {
  readonly open: boolean;
  readonly workspace: WorkspaceRecord | undefined;
  readonly sessionId: string | undefined;
  readonly onHide: () => void;
}) {
  // The dock grabs focus for its shell only on the render that opens it. A
  // thread switch remounts the panel under an already-open dock, and focusing
  // there would send the new thread's typing to a shell instead of the composer.
  const wasOpen = useRef(open);
  const justOpened = open && !wasOpen.current;
  useEffect(() => {
    wasOpen.current = open;
  }, [open]);

  if (!workspace || !sessionId) return null;
  return (
    <BottomTerminal open={open}>
      <TerminalPanel
        autoFocus={justOpened}
        key={`${workspace.id}:${sessionId}`}
        onHide={onHide}
        sessionId={sessionId}
        workspace={workspace}
      />
    </BottomTerminal>
  );
}
