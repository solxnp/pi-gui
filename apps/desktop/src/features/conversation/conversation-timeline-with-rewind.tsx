import type { useTurnChanges } from "./hooks/use-turn-changes";
import { ConversationTimeline, type ConversationTimelineProps } from "./conversation-timeline";
import { RewindConfirmDialog } from "./rewind-confirm-dialog";

type TurnChanges = ReturnType<typeof useTurnChanges>;

/**
 * The timeline plus the rewind flow its turn cards offer. Owning the dialog here keeps the app shell
 * from carrying another surface, and the dialog cannot outlive the thread whose turn it belongs to.
 */
export function ConversationTimelineWithRewind(
  props: Omit<ConversationTimelineProps, "onOpenTurnChange"> & {
    readonly turnChanges: TurnChanges;
  },
) {
  const { turnChanges, ...timelineProps } = props;
  const { rewind } = turnChanges;

  return (
    <>
      <ConversationTimeline
        {...timelineProps}
        onOpenTurnChange={turnChanges.openTurnChange}
        rewindOutcomes={rewind.outcomes}
        onRewindTurn={rewind.requestRewind}
        onUndoRewind={rewind.undoRewind}
      />
      {rewind.confirm ? (
        <RewindConfirmDialog
          state={rewind.confirm}
          onCancel={rewind.cancelRewind}
          onConfirm={(paths) => rewind.confirmRewind(paths)}
        />
      ) : null}
    </>
  );
}
