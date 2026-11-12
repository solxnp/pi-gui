import { Sidebar, type SidebarProps } from "./sidebar";
import { ThreadOverview } from "./thread-overview";

interface ThreadListPanelProps extends SidebarProps {
  readonly open: boolean;
  readonly onClose: () => void;
}

/**
 * 「全部会话」: the conversation list that used to be the left column, in the
 * overlay it now lives in. Picking a thread opens its tab and closes the panel.
 */
export function ThreadListPanel({ open, onClose, ...sidebar }: ThreadListPanelProps) {
  return (
    <ThreadOverview open={open} onClose={onClose}>
      <Sidebar {...sidebar} mode="overview" />
    </ThreadOverview>
  );
}
