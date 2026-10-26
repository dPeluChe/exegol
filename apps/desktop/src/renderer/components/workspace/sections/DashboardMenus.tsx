import { LIVE_STATUSES } from "@exegol/shared";
import {
  AArrowDown,
  AArrowUp,
  Archive,
  ArrowUpRight,
  BellOff,
  ChevronDown,
  ChevronUp,
  Clipboard,
  Maximize2,
  Minimize2,
  Moon,
  Pause,
  PictureInPicture2,
  Pin,
  PinOff,
  Play,
  RefreshCw,
  RotateCcw,
  Send,
} from "lucide-react";
import type { RefObject } from "react";
import { useResumeAgent } from "../../../hooks/use-resume-agent";
import {
  type FleetMenuItem,
  fleetCardMenu,
  type WatchMenuItem,
  watchCardMenu,
} from "../../../lib/dashboard-menu";
import { kickTerminal } from "../../../lib/dispatch-refit";
import { floatAgentPane } from "../../../lib/float-pane";
import { setAgentMuted, suspendAgent } from "../../../lib/session-quiet";
import { type AgentState, findAgentPane } from "../../../stores/agents";
import { DEFAULT_CARD_FONT, stepCardFont, useWatchStore } from "../../../stores/watch";
import { useWorkspaceStore } from "../../../stores/workspace";
import { ContextMenu, type MenuItem } from "../../common/ContextMenu";
import { SendSelectionMenu } from "../../terminal/SendToList";
import type { TerminalInstanceHandle } from "../../terminal/TerminalInstance";

/** The pane menu's "Send selection to" page, for the mirror's selection */
function sendSelectionItems(
  agent: AgentState,
  selection: string,
  terminalRef: RefObject<TerminalInstanceHandle | null> | undefined,
): MenuItem[] {
  // A TUI repaint can clear the mirror's selection while the page is open
  const getSelection = () => terminalRef?.current?.getSelection() || selection;
  const source = { agentId: agent.id, projectId: agent.projectId, getSelection };
  return [
    {
      label: "Send selection to",
      icon: Send,
      action: () => {},
      page: ({ back, done }) => <SendSelectionMenu source={source} onBack={back} onDone={done} />,
    },
  ];
}

/** Labelled like ResumeButton: a CLI that cannot continue a session starts it again */
const resumeItem = (canResume: boolean, action: () => void): MenuItem => ({
  label: canResume ? "Resume" : "Re-launch",
  icon: canResume ? Play : RotateCcw,
  action,
});

/** Its pane, when it has one that is not floating already */
function floatablePane(agent: AgentState): string | null {
  const location = findAgentPane(agent.id, agent.projectId);
  if (!location) return null;
  return useWorkspaceStore.getState().floatingPanes[location.paneId] ? null : location.paneId;
}

/** Right-click on a pinned session (card or collapsed strip) with its row still in the store */
export function WatchCardMenu({
  agent,
  expanded,
  terminalRef,
  onOpenAgent,
  onCollapse,
  children,
}: {
  agent: AgentState;
  expanded: boolean;
  /** The mirror, for its selection; absent on a strip */
  terminalRef?: RefObject<TerminalInstanceHandle | null>;
  onOpenAgent: (agent: AgentState) => void;
  /** The card's own collapse (a question-opened card marks it read instead) */
  onCollapse?: () => void;
  children: React.ReactNode;
}) {
  const { resume, resumableCliTypes } = useResumeAgent();

  const sections = () => {
    const canResume = resumableCliTypes.has(agent.cliType);
    const store = useWatchStore.getState();
    const selection = terminalRef?.current?.getSelection() ?? "";
    const paneId = floatablePane(agent);
    const sizing = store.cardFont[agent.id] !== undefined;
    const ids = watchCardMenu({
      live: LIVE_STATUSES.has(agent.status),
      expanded,
      hasSelection: selection.length > 0,
      sizing,
      canFloat: paneId !== null,
    });
    const item = (id: WatchMenuItem): MenuItem[] => {
      switch (id) {
        case "go-to":
          return [{ label: "Go to Session", icon: ArrowUpRight, action: () => onOpenAgent(agent) }];
        case "copy":
          return [
            {
              label: "Copy",
              icon: Clipboard,
              shortcut: "⌘C",
              action: () => void navigator.clipboard.writeText(selection),
            },
          ];
        case "send-selection":
          return sendSelectionItems(agent, selection, terminalRef);
        case "resume":
          return [resumeItem(canResume, () => void resume(agent).catch(() => {}))];
        case "collapse":
          return [
            {
              label: "Collapse",
              icon: ChevronDown,
              action: onCollapse ?? (() => store.toggleOpen(agent.id)),
            },
          ];
        case "expand":
          return [{ label: "Expand", icon: ChevronUp, action: () => store.toggleOpen(agent.id) }];
        case "fit-to-card":
          return [
            {
              label: "Fit Session to Card",
              icon: Maximize2,
              action: () => store.setCardFont(agent.id, DEFAULT_CARD_FONT),
            },
          ];
        case "stop-fit":
          return [
            {
              label: "Stop Fitting to Card",
              icon: Minimize2,
              action: () => store.setCardFont(agent.id, null),
            },
          ];
        case "font-smaller":
          return [
            { label: "Smaller Text", icon: AArrowDown, action: () => stepCardFont(agent.id, -1) },
          ];
        case "font-larger":
          return [
            { label: "Larger Text", icon: AArrowUp, action: () => stepCardFont(agent.id, 1) },
          ];
        case "refresh":
          return [
            { label: "Refresh Terminal", icon: RefreshCw, action: () => kickTerminal(agent.id) },
          ];
        case "float":
          return paneId
            ? [
                {
                  label: "Float to Window",
                  icon: PictureInPicture2,
                  action: () => floatAgentPane(agent.projectId, paneId),
                },
              ]
            : [];
        case "unpin":
          return [{ label: "Unpin", icon: PinOff, action: () => store.unwatch(agent.id) }];
      }
    };
    return ids.map((section) => ({ items: section.flatMap(item) }));
  };

  return <ContextMenu sections={sections}>{children}</ContextMenu>;
}

/** Right-click on a fleet card: the same actions as its buttons and the terminal toolbar */
export function FleetCardMenu({
  agent,
  onOpen,
  onArchive,
  children,
}: {
  agent: AgentState;
  onOpen: () => void;
  onArchive?: () => void;
  children: React.ReactNode;
}) {
  const { resume, resumableCliTypes } = useResumeAgent();

  const sections = () => {
    const watch = useWatchStore.getState();
    const canResume = resumableCliTypes.has(agent.cliType);
    const ids = fleetCardMenu({
      live: LIVE_STATUSES.has(agent.status),
      shell: agent.cliType === "shell",
      watched: watch.watched.includes(agent.id),
      muted: !!agent.muted,
    });
    const item = (id: FleetMenuItem): MenuItem[] => {
      switch (id) {
        case "go-to":
          return [{ label: "Go to Session", icon: ArrowUpRight, action: onOpen }];
        case "watch":
          return [
            { label: "Watch in Dashboard", icon: Pin, action: () => watch.toggleWatch(agent.id) },
          ];
        case "unwatch":
          return [{ label: "Stop Watching", icon: PinOff, action: () => watch.unwatch(agent.id) }];
        case "mute":
          return [
            {
              label: "Mute",
              icon: BellOff,
              action: () => void setAgentMuted(agent.id, true).catch(() => {}),
            },
          ];
        case "unmute":
          return [
            {
              label: "Unmute",
              icon: Moon,
              action: () => void setAgentMuted(agent.id, false).catch(() => {}),
            },
          ];
        case "suspend":
          return [
            {
              label: "Suspend",
              icon: Pause,
              action: () => void suspendAgent(agent.id).catch(() => {}),
            },
          ];
        case "resume":
          return [resumeItem(canResume, () => void resume(agent).catch(() => {}))];
        case "archive":
          return onArchive ? [{ label: "Archive", icon: Archive, action: onArchive }] : [];
      }
    };
    return ids.map((section) => ({ items: section.flatMap(item) }));
  };

  return <ContextMenu sections={sections}>{children}</ContextMenu>;
}
