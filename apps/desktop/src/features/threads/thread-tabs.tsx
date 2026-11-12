import { useCallback, useEffect, useRef } from "react";
import type { WorkspaceSessionTarget } from "../../../contracts/desktop-state";
import { CloseIcon } from "../../ui/icons";
import { useTranslation } from "../../i18n";

/** How many rows the strip may use before it scrolls sideways instead of growing. */
export const THREAD_TAB_MAX_ROWS = 3;
const THREAD_TAB_ROW_HEIGHT = 32;
const THREAD_TAB_GAP = 4;

export interface ThreadTabEntry {
  readonly target: WorkspaceSessionTarget;
  readonly key: string;
  readonly title: string;
  /** Root workspace name, shown in the tooltip so two projects read apart. */
  readonly projectName: string;
  readonly status: "running" | "failed" | "unseen" | "none";
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
 * Rows and columns for a row-major strip that never exceeds `THREAD_TAB_MAX_ROWS`:
 * five tabs use two rows of three and two, not three rows of two.
 */
export function threadTabLayout(count: number): { readonly rows: number; readonly columns: number } {
  if (count <= 0) return { rows: 0, columns: 0 };
  const rows = Math.min(THREAD_TAB_MAX_ROWS, count);
  return { rows, columns: Math.ceil(count / rows) };
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
export function ThreadTabs({
  tabs,
  activeKey,
  platform,
  onSelect,
  onClose,
}: ThreadTabsProps) {
  const { t } = useTranslation();
  const stripRef = useRef<HTMLDivElement | null>(null);
  const tabRefs = useRef(new Map<string, HTMLButtonElement>());
  const { rows, columns } = threadTabLayout(tabs.length);

  useEffect(() => {
    if (!activeKey) return;
    tabRefs.current.get(activeKey)?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [activeKey, tabs.length]);

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
        height: rows * THREAD_TAB_ROW_HEIGHT + (rows - 1) * THREAD_TAB_GAP,
        ["--thread-tabs-columns" as string]: String(columns),
        ["--thread-tabs-rows" as string]: String(rows),
      }}
    >
      {tabs.map((tab, index) => {
        const active = tab.key === activeKey;
        const slot = threadTabSlot(index, columns);
        return (
          <div
            className={`thread-tabs__tab${active ? " thread-tabs__tab--active" : ""}`}
            data-testid={`thread-tab-${tab.key}`}
            key={tab.key}
            style={{ gridRow: slot.row, gridColumn: slot.column }}
          >
            <button
              aria-keyshortcuts={
                index < 9 ? `${platform === "darwin" ? "Meta" : "Control"}+${index + 1}` : undefined
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
                <span
                  aria-label={t("threadTabs.awaitingInput")}
                  className="thread-tabs__dot thread-tabs__dot--input"
                />
              ) : tab.status !== "none" ? (
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
              ) : null}
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
