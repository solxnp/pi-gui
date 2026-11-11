import { useState } from "react";
import { hasTimelineRail, type TimelineRailTick } from "./timeline-rail-model";

interface TimelineRailProps {
  readonly ticks: readonly TimelineRailTick[];
  /** Recent transcript scrolling: ticks brighten so they can be aimed at mid-scroll. */
  readonly active: boolean;
  readonly onJump: (rowId: string) => void;
  /** The rail sits outside the scroller, so wheel motion over it is handed back to the pane. */
  readonly onScrollBy: (deltaY: number) => void;
}

/**
 * A minimap for the prompts the user sent. Each tick sits at that prompt's share of the whole
 * thread and jumps the viewport to it; hovering (or focusing) one previews what was asked. It
 * lives beside the scroller instead of inside it, so it never scrolls away and never eats the
 * pane's scrollbar and text-selection hit areas.
 */
export function TimelineRail({ ticks, active, onJump, onScrollBy }: TimelineRailProps) {
  const [previewId, setPreviewId] = useState<string | null>(null);
  if (!hasTimelineRail(ticks)) return null;
  const preview = ticks.find((tick) => tick.rowId === previewId) ?? null;
  return (
    <div
      className={active ? "timeline-rail timeline-rail--active" : "timeline-rail"}
      data-testid="timeline-rail"
      onWheel={(event) => onScrollBy(event.deltaY)}
    >
      <div className="timeline-rail__track" role="group" aria-label="Jump to your message">
        {ticks.map((tick) => (
          <button
            key={tick.rowId}
            type="button"
            className={
              tick.active
                ? "timeline-rail__tick timeline-rail__tick--current"
                : "timeline-rail__tick"
            }
            data-testid="timeline-rail-tick"
            data-row-id={tick.rowId}
            data-index={tick.index}
            style={{ top: `calc(${tick.fraction * 100}% - 1px)` }}
            aria-label={`Your message ${tick.index} of ${ticks.length}`}
            aria-current={tick.active ? "true" : undefined}
            onPointerEnter={() => setPreviewId(tick.rowId)}
            onFocus={() => setPreviewId(tick.rowId)}
            onPointerLeave={() =>
              setPreviewId((current) => (current === tick.rowId ? null : current))
            }
            onBlur={() => setPreviewId((current) => (current === tick.rowId ? null : current))}
            onClick={() => {
              setPreviewId(null);
              onJump(tick.rowId);
            }}
          />
        ))}
      </div>
      {preview ? (
        <div
          className="timeline-rail__preview"
          data-testid="timeline-rail-preview"
          style={{
            // Clamped so a tick near either end still shows its card inside the thread pane.
            top: `clamp(52px, ${preview.fraction * 100}%, calc(100% - 52px))`,
          }}
        >
          <div className="timeline-rail__preview-title">
            Your message {preview.index} of {ticks.length}
          </div>
          <p className="timeline-rail__preview-body">{preview.preview}</p>
          <div className="timeline-rail__preview-hint">Click to jump</div>
        </div>
      ) : null}
    </div>
  );
}
