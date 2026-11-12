import { useEffect, useRef, useState, type ReactNode } from "react";
import { CloseIcon } from "../../ui/icons";
import { useTranslation } from "../../i18n";

interface ThreadOverviewProps {
  readonly open: boolean;
  readonly onClose: () => void;
  /** The thread list, rendered by the composition root with the docked list's props. */
  readonly children: ReactNode;
}

/**
 * 「全部会话」: the conversation list that used to be the left column, shown over
 * the transcript on demand. Picking a thread opens its tab and closes this panel.
 */
export function ThreadOverview({ open, onClose, children }: ThreadOverviewProps) {
  const { t } = useTranslation();
  const panelRef = useRef<HTMLDivElement | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const [top, setTop] = useState(0);

  useEffect(() => {
    if (!open) return undefined;
    // Sit just below the thread tabs instead of covering them; their height
    // depends on how many rows the open conversations need.
    const strip = document.querySelector('[data-testid="thread-tabs"]');
    setTop(strip ? strip.getBoundingClientRect().bottom + 6 : 0);
    closeRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented || event.isComposing || event.repeat)
        return;
      // An open menu or rename field inside the list owns this Escape.
      if (document.querySelector("[role='menu'], [aria-modal='true']:not(.thread-overview)"))
        return;
      event.preventDefault();
      onClose();
    };
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (panelRef.current?.contains(target)) return;
      // Menus opened from the list render in portals; a click inside them is not "outside".
      if (target instanceof Element && target.closest("[role='menu'], .workspace-menu")) return;
      onClose();
    };
    window.addEventListener("keydown", handleKeyDown, true);
    document.addEventListener("pointerdown", handlePointerDown, true);
    return () => {
      window.removeEventListener("keydown", handleKeyDown, true);
      document.removeEventListener("pointerdown", handlePointerDown, true);
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="thread-overview" data-testid="thread-overview" style={{ paddingTop: top }}>
      <div
        aria-label={t("threadOverview.title")}
        aria-modal="false"
        className="thread-overview__panel"
        ref={panelRef}
        role="dialog"
      >
        <div className="thread-overview__head">
          <strong>{t("threadOverview.title")}</strong>
          <button
            aria-label={t("threadOverview.close")}
            className="icon-button"
            onClick={onClose}
            ref={closeRef}
            title={t("threadOverview.close")}
            type="button"
          >
            <CloseIcon />
          </button>
        </div>
        <div className="thread-overview__body">{children}</div>
      </div>
    </div>
  );
}
