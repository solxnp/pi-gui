import { useCallback, useEffect, useRef, useState } from "react";
import type { WorkspaceSessionTarget } from "../../../contracts/desktop-state";
import { CloseIcon } from "../../ui/icons";
import { useTranslation } from "../../i18n";

/** How many rows the strip may use before it scrolls sideways instead of growing. */
export const THREAD_TAB_MAX_ROWS = 3;
const THREAD_TAB_ROW_HEIGHT = 32;
const THREAD_TAB_GAP = 4;
/** Bottom padding under the last row, so the strip height matches its box. */
const THREAD_TAB_PADDING = 6;
/** One tab plus the gap between tabs; a row holds as many as the strip's width allows. */
const THREAD_TAB_SLOT_WIDTH = 172;

export interface ThreadTabEntry {
  readonly target: WorkspaceSessionTarget;
  readonly key: string;
  readonly title: string;
  /** Root workspace name, shown in the tooltip so two projects read apart. */
  readonly projectName: string;
  /** running · failed · unseen (finished, not read yet) · idle (finished, read). */
  readonly status: "running" | "failed" | "unseen" | "idle";
  /** An extension dialog is waiting in this conversation. */
  readonly awaitingInput: boolean;
}

interface ThreadTabsProps {
  readonly tabs: readonly ThreadTabEntry[];
  readonly activeKey: string | undefined;
  readonly platform: NodeJS.Platform;
  readonly onSelect: (target: WorkspaceSessionTarget) => void;
  readonly onClose: (target: WorkspaceSessionTarget) => void;
}

/**
 * Rows and columns for a row-major strip: tabs stay on one row while they fit,
 * wrap only as wide as the strip allows, and stop at `THREAD_TAB_MAX_ROWS` rows —
 * past that the strip scrolls sideways rather than pushing the transcript down.
 *
 * Fitting rows are filled to capacity instead of being evened out: with room for
 * six, seven tabs read 6 + 1, never 4 + 3, so a wide window never wraps while
 * its first row is still half empty. Only past the row cap does the column count
 * grow (and the strip start scrolling) to keep every tab inside three rows.
 */
export function threadTabLayout(
  count: number,
  availableWidth: number,
): { readonly rows: number; readonly columns: number } {
  if (count <= 0) return { rows: 0, columns: 0 };
  const perRow = Math.max(1, Math.floor(availableWidth / THREAD_TAB_SLOT_WIDTH));
  if (count <= perRow * THREAD_TAB_MAX_ROWS) {
    return { rows: Math.ceil(count / perRow), columns: perRow };
  }
  return { rows: THREAD_TAB_MAX_ROWS, columns: Math.ceil(count / THREAD_TAB_MAX_ROWS) };
}

/** The grid slot of a tab, so reading order stays left-to-right, then the next row. */
export function threadTabSlot(
  index: number,
  columns: number,
): { readonly row: number; readonly column: number } {
  return { row: Math.floor(index / columns) + 1, column: (index % columns) + 1 };
}

/**
 * The window's open conversations as IDE-style tabs above the transcript.
 * Tabs keep their order, so ⌘1-9 can address them by position.
 */
export function ThreadTabs({ tabs, activeKey, platform, onSelect, onClose }: ThreadTabsProps) {
  const { t } = useTranslation();
  const stripRef = useRef<HTMLDivElement | null>(null);
  const tabRefs = useRef(new Map<string, HTMLButtonElement>());
  const [availableWidth, setAvailableWidth] = useState(0);
  // Without a measurement the strip is unknown, so keep the tabs on one row
  // rather than wrapping into a second row the width does not require.
  const { rows, columns } = threadTabLayout(
    tabs.length,
    availableWidth || tabs.length * THREAD_TAB_SLOT_WIDTH,
  );

  useEffect(() => {
    // The strip is not in the document until the first tab exists, and its width
    // changes with the side panel, so re-measure whenever either can differ.
    const strip = stripRef.current;
    if (!strip) return undefined;
    const measure = () => setAvailableWidth(strip.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(strip);
    return () => observer.disconnect();
  }, [tabs.length]);

  const stripHeight =
    rows > 0 ? rows * THREAD_TAB_ROW_HEIGHT + (rows - 1) * THREAD_TAB_GAP + THREAD_TAB_PADDING : 0;

  useEffect(() => {
    if (!activeKey) return;
    tabRefs.current.get(activeKey)?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [activeKey, tabs.length]);

  useEffect(() => {
    // Overlays opened from the topbar start below the strip instead of covering it.
    document.documentElement.style.setProperty("--thread-tabs-height", `${stripHeight}px`);
    return () => {
      document.documentElement.style.removeProperty("--thread-tabs-height");
    };
  }, [stripHeight]);

  const onTabKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
      const next =
        event.key === "ArrowRight"
          ? index + 1
          : event.key === "ArrowLeft"
            ? index - 1
            : event.key === "Home"
              ? 0
              : event.key === "End"
                ? tabs.length - 1
                : undefined;
      if (next === undefined) return;
      event.preventDefault();
      const target = tabs[next];
      if (!target) return;
      onSelect(target.target);
      tabRefs.current.get(target.key)?.focus();
    },
    [onSelect, tabs],
  );

  if (tabs.length === 0) return null;

  return (
    <div
      aria-label={t("threadTabs.label")}
      className="thread-tabs"
      data-testid="thread-tabs"
      ref={stripRef}
      role="tablist"
      style={{
        height: stripHeight,
        ["--thread-tabs-columns" as string]: String(columns),
        ["--thread-tabs-rows" as string]: String(rows),
      }}
    >
      {tabs.map((tab, index) => {
        const active = tab.key === activeKey;
        const slot = threadTabSlot(index, columns);
        return (
          <div
            className={`thread-tabs__tab thread-tabs__tab--${tab.status}${
              active ? " thread-tabs__tab--active" : ""
            }${tab.awaitingInput ? " thread-tabs__tab--input" : ""}`}
            data-testid={`thread-tab-${tab.key}`}
            key={tab.key}
            style={{ gridRow: slot.row, gridColumn: slot.column }}
          >
            <button
              aria-keyshortcuts={
                index < 9 ? `${platform === "darwin" ? "Meta" : "Control"}+${index + 1}` : undefined
              }
              aria-label={
                tab.awaitingInput
                  ? `${tab.title} · ${t("threadTabs.awaitingInput")}`
                  : `${tab.title} · ${
                      tab.status === "running"
                        ? t("threadTabs.running")
                        : tab.status === "failed"
                          ? t("threadTabs.failed")
                          : tab.status === "unseen"
                            ? t("threadTabs.unseen")
                            : t("threadTabs.idle")
                    }`
              }
              aria-selected={active}
              className="thread-tabs__select"
              onClick={() => onSelect(tab.target)}
              onKeyDown={(event) => onTabKeyDown(event, index)}
              ref={(button) => {
                if (button) tabRefs.current.set(tab.key, button);
                else tabRefs.current.delete(tab.key);
              }}
              role="tab"
              tabIndex={active ? 0 : -1}
              title={`${tab.projectName} · ${tab.title}`}
              type="button"
            >
              {tab.awaitingInput ? (
                <span className="thread-tabs__badge thread-tabs__badge--input">
                  {t("threadTabs.awaitingInputBadge")}
                </span>
              ) : tab.status === "idle" ? null : (
                <span
                  aria-label={
                    tab.status === "running"
                      ? t("threadTabs.running")
                      : tab.status === "failed"
                        ? t("threadTabs.failed")
                        : t("threadTabs.unseen")
                  }
                  className={`thread-tabs__dot thread-tabs__dot--${tab.status}`}
                />
              )}
              <span className="thread-tabs__title">{tab.title}</span>
            </button>
            <button
              aria-label={t("threadTabs.close", { title: tab.title })}
              className="thread-tabs__close icon-button"
              onClick={() => onClose(tab.target)}
              tabIndex={-1}
              title={t("threadTabs.close", { title: tab.title })}
              type="button"
            >
              <CloseIcon />
            </button>
          </div>
        );
      })}
    </div>
  );
}
