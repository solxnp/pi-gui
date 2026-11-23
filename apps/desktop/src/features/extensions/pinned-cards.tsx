import { useCallback, useEffect, useMemo, useState } from "react";
import type { SessionTranscriptPin } from "@pi-gui/session-driver";
import type { TranscriptMessage } from "../../../contracts/timeline-types";
import { useTranslation } from "../../i18n";
import { ExtensionCardItem, type RunExtensionAction } from "../conversation/extension-card";
import { ChevronDownIcon, ChevronRightIcon, CloseIcon } from "../../ui/icons";
import { focusComposerAfter } from "./focus-composer";
import {
  currentActivity,
  describePinFreshness,
  shouldWarnStale,
  type CurrentActivity,
} from "./pinned-card-freshness";
import { splitPinnedCards, visiblePinnedCards, type PinnedCard } from "./pinned-cards-model";

export type { PinnedCard } from "./pinned-cards-model";

/** What {@link usePinnedCards} returns: the cards plus the live facts drawn beside them. */
export type PinnedCardStack = ReturnType<typeof usePinnedCards>;

/**
 * Splits the selected thread's pins off its transcript and keeps which ones the user hid or
 * collapsed. Both live here at app level, keyed by thread and pin, so they survive switching
 * threads. A hidden pin remembers the write it hid; the extension writing it again shows it.
 */
export function usePinnedCards(
  sessionKey: string,
  transcript: readonly TranscriptMessage[],
  running: boolean,
) {
  const [dismissedAt, setDismissedAt] = useState<ReadonlyMap<string, string>>(() => new Map());
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set());
  const { timeline, pins } = useMemo(() => splitPinnedCards(transcript), [transcript]);
  const visiblePins = useMemo(
    () =>
      visiblePinnedCards(
        pins,
        (pin) => dismissedAt.get(pinStateKey(sessionKey, pin)) === pin.createdAt,
      ),
    [dismissedAt, pins, sessionKey],
  );
  const collapsedPinIds = useMemo(
    () =>
      new Set(
        visiblePins.flatMap((pin) => (collapsed.has(pinStateKey(sessionKey, pin)) ? [pin.id] : [])),
      ),
    [collapsed, sessionKey, visiblePins],
  );
  const dismissPin = useCallback(
    (pin: PinnedCard) =>
      setDismissedAt((current) =>
        new Map(current).set(pinStateKey(sessionKey, pin), pin.createdAt),
      ),
    [sessionKey],
  );
  const togglePin = useCallback(
    (pin: PinnedCard) =>
      setCollapsed((current) => {
        const key = pinStateKey(sessionKey, pin);
        const next = new Set(current);
        if (!next.delete(key)) next.add(key);
        return next;
      }),
    [sessionKey],
  );
  // The card's own age and the run's current step both come from data the thread already has,
  // so no pinned card has to wait on its writer to look alive.
  const activity = useMemo(() => currentActivity(transcript), [transcript]);
  return { timeline, visiblePins, collapsedPinIds, dismissPin, togglePin, running, activity };
}

function pinStateKey(sessionKey: string, pin: SessionTranscriptPin): string {
  return `${sessionKey}\u0000${pin.id}`;
}

/** Cards an extension pinned with `pi.appendEntry("pi-gui.pin", ...)`, stacked above the composer. */
export function PinnedCards({
  stack,
  onToggle,
  onDismiss,
  onAction,
}: {
  readonly stack: PinnedCardStack;
  readonly onToggle: (pin: PinnedCard) => void;
  readonly onDismiss: (pin: PinnedCard) => void;
  readonly onAction: RunExtensionAction;
}) {
  const now = useMinuteClock();
  const { visiblePins: pins, collapsedPinIds, running, activity } = stack;
  if (pins.length === 0) return null;
  return (
    <div className="pinned-cards" data-testid="pinned-cards">
      {pins.map((pin) => {
        const collapsed = collapsedPinIds.has(pin.id);
        const canCollapse = pin.card.rows.length > 0 || pin.card.actions.length > 0;
        return (
          <ExtensionCardItem
            key={pin.id}
            card={pin.card}
            collapsed={collapsed}
            onAction={onAction}
            footer={
              <PinFreshness
                createdAt={pin.createdAt}
                now={now}
                running={running}
                activity={activity}
              />
            }
            controls={
              <span className="pinned-card__controls">
                {canCollapse ? (
                  <button
                    aria-expanded={!collapsed}
                    aria-label={`${collapsed ? "Expand" : "Collapse"} ${pin.card.title}`}
                    className="pinned-card__control icon-button"
                    data-testid="pinned-card-toggle"
                    title={collapsed ? "Expand" : "Collapse"}
                    type="button"
                    onClick={() => onToggle(pin)}
                  >
                    {collapsed ? <ChevronRightIcon /> : <ChevronDownIcon />}
                  </button>
                ) : null}
                <button
                  aria-label={`Hide ${pin.card.title}`}
                  className="pinned-card__control icon-button"
                  data-testid="pinned-card-dismiss"
                  title="Hide until it changes"
                  type="button"
                  onClick={(event) => focusComposerAfter(event.currentTarget, () => onDismiss(pin))}
                >
                  <CloseIcon />
                </button>
              </span>
            }
          />
        );
      })}
    </div>
  );
}

/**
 * Re-renders every 30 seconds so an age can be displayed without every card keeping its own
 * timer. One clock for the whole stack: the cards age together.
 */
function useMinuteClock(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);
  return now;
}

/**
 * Says how old the card is, and only calls it a problem while a run is actually going: a card
 * that is old because the work finished is not stale, it is just done.
 */
function PinFreshness({
  createdAt,
  now,
  running,
  activity,
}: {
  readonly createdAt: string;
  readonly now: number;
  readonly running: boolean;
  readonly activity?: CurrentActivity;
}) {
  const { t } = useTranslation();
  const freshness = describePinFreshness(createdAt, now);
  const stale = shouldWarnStale(createdAt, now, running);
  return (
    <span
      className={`pinned-card__freshness ${stale ? "pinned-card__freshness--stale" : ""}`}
      data-testid="pinned-card-freshness"
      data-stale={stale ? "true" : "false"}
      data-minutes={Number.isFinite(freshness.minutes) ? freshness.minutes : ""}
      title={stale ? t("pinnedCard.staleHint") : undefined}
    >
      {!Number.isFinite(freshness.minutes) || freshness.minutes < 1
        ? t("pinnedCard.justUpdated")
        : t("pinnedCard.updatedMinutesAgo", { minutes: freshness.minutes })}
      {stale ? ` · ${t("pinnedCard.mayBeOutdated")}` : ""}
      {activity?.label ? (
        <span
          className="pinned-card__activity"
          data-testid="pinned-card-activity"
          data-live={activity.live ? "true" : "false"}
        >
          {` · ${
            activity.live
              ? t("pinnedCard.nowRunning", { activity: activity.label })
              : t("pinnedCard.lastActivity", { activity: activity.label })
          }`}
        </span>
      ) : null}
    </span>
  );
}
