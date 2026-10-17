import {
  ArrowDownToLine,
  ArrowUpToLine,
  Camera,
  Clipboard,
  ClipboardPaste,
  Columns,
  Equal,
  Eraser,
  Globe,
  MoveRight,
  Pencil,
  PictureInPicture2,
  RefreshCw,
  Rows,
  Send,
  TerminalSquare,
  Trash2,
} from "lucide-react";
import { useState } from "react";
import { movePane, paneMoveTargets } from "../../lib/move-pane";
import type { PaneType } from "../../stores/workspace";
import { ContextMenu, type MenuItem, type MenuSection } from "../common/ContextMenu";
import { SendSelectionMenu } from "../terminal/SendToList";
import { selectionSourceFor } from "../terminal/use-send-to";

interface PaneContextMenuProps {
  tabId: string;
  paneId: string;
  paneType: PaneType;
  agentId?: string;
  isSplitPane: boolean;
  onSplit: (direction: "horizontal" | "vertical", newType?: PaneType) => void;
  /** A shell beside this pane, in the folder it works in (lib/split-terminal) */
  onSplitTerminal: () => void;
  onEqualize: () => void;
  onClose: () => void;
  /** Only wired for terminal/browser panes — undefined hides the menu entry */
  onFloat?: () => void;
  onCopy?: () => void;
  onPaste?: () => void;
  onScrollTop?: () => void;
  onScrollBottom?: () => void;
  /** Browser panes: save the page as an image */
  onScreenshot?: () => void;
  children: React.ReactNode;
}

type MenuActions = Omit<PaneContextMenuProps, "children">;

const present = (items: (MenuItem | false | undefined)[]): MenuItem[] =>
  items.filter((item): item is MenuItem => Boolean(item));

function clipboardSection({ onCopy, onPaste }: MenuActions): MenuItem[] {
  return present([
    onCopy && { label: "Copy", icon: Clipboard, shortcut: "⌘C", action: onCopy },
    onPaste && { label: "Paste", icon: ClipboardPaste, shortcut: "⌘V", action: onPaste },
  ]);
}

function terminalActionsSection({ agentId, onScrollTop, onScrollBottom }: MenuActions): MenuItem[] {
  const items = present([
    onScrollTop && { label: "Scroll to Top", icon: ArrowUpToLine, action: onScrollTop },
    onScrollBottom && { label: "Scroll to Bottom", icon: ArrowDownToLine, action: onScrollBottom },
  ]);
  // T155 (verify session): manual repaint escape hatch — refit + SIGWINCH
  // jiggle for alt-screen TUIs that come back black after a reload.
  if (agentId) {
    // T160: alias = the agent_send addressing name; the SessionAlias chip in
    // the toolbar listens for this event and enters edit mode.
    items.push({
      label: "Rename Session",
      icon: Pencil,
      action: () =>
        window.dispatchEvent(new CustomEvent("exegol:rename-session", { detail: { agentId } })),
    });
    items.push({
      label: "Clear Terminal",
      icon: Eraser,
      action: () =>
        window.dispatchEvent(new CustomEvent("exegol:clear-terminal", { detail: { agentId } })),
    });
    items.push({
      label: "Refresh Terminal",
      icon: RefreshCw,
      action: () =>
        window.dispatchEvent(new CustomEvent("exegol:kick-terminal", { detail: { agentId } })),
    });
  }
  return items;
}

function browserSection({ onScreenshot }: MenuActions): MenuItem[] {
  return present([
    onScreenshot && { label: "Save Screenshot...", icon: Camera, action: onScreenshot },
  ]);
}

function moveSection({ paneId }: MenuActions): MenuItem[] {
  return paneMoveTargets(paneId).map((target) => ({
    id: `move:${target.tabId}`,
    label: `Move to ${target.tabId === "new" ? "New Tab" : `Tab: ${target.label}`}`,
    icon: MoveRight,
    action: () => movePane(paneId, target.tabId),
  }));
}

function splitSection({
  isSplitPane,
  onSplit,
  onSplitTerminal,
  onFloat,
  onEqualize,
}: MenuActions): MenuItem[] {
  return [
    {
      label: "Split Horizontally",
      icon: Columns,
      shortcut: "⌘D",
      action: () => onSplit("horizontal"),
    },
    { label: "Split Vertically", icon: Rows, shortcut: "⌘⇧D", action: () => onSplit("vertical") },
    { label: "Split with Browser", icon: Globe, action: () => onSplit("horizontal", "browser") },
    { label: "Split with Terminal", icon: TerminalSquare, shortcut: "⌘Y", action: onSplitTerminal },
    ...(onFloat ? [{ label: "Float to Window", icon: PictureInPicture2, action: onFloat }] : []),
    ...(isSplitPane ? [{ label: "Equalize Splits", icon: Equal, action: onEqualize }] : []),
  ];
}

function buildMenuSections(actions: MenuActions, sendPage?: MenuItem["page"]): MenuSection[] {
  const isTerminal = actions.paneType === "terminal";
  const send: MenuItem[] = sendPage
    ? [{ label: "Send selection to", icon: Send, action: () => {}, page: sendPage }]
    : [];
  const candidates = [
    ...(isTerminal
      ? [[...send, ...clipboardSection(actions)], terminalActionsSection(actions)]
      : []),
    browserSection(actions),
    splitSection(actions),
    moveSection(actions),
  ];
  return [
    ...candidates.filter((items) => items.length > 0).map((items) => ({ items })),
    {
      items: [
        {
          label: `Close ${isTerminal ? "Terminal" : "Pane"}`,
          icon: Trash2,
          action: actions.onClose,
          danger: true,
        },
      ],
    },
  ];
}

export function PaneContextMenu({ children, ...actions }: PaneContextMenuProps) {
  // The selection when the menu opened: a TUI repaint or mouse report can clear it before a pick
  const [openedWith, setOpenedWith] = useState("");
  const readSelection = () =>
    actions.paneType === "terminal"
      ? (selectionSourceFor(actions.paneId)?.getSelection() ?? "")
      : "";

  const sendPage = (): MenuItem["page"] => {
    const live = actions.paneType === "terminal" ? selectionSourceFor(actions.paneId) : undefined;
    if (!live || !openedWith) return undefined;
    const source = { ...live, getSelection: () => live.getSelection() || openedWith };
    return ({ back, done }) => <SendSelectionMenu source={source} onBack={back} onDone={done} />;
  };

  // Built on open only: the move list reads the tabs and sessions of that moment
  return (
    <ContextMenu
      onOpen={() => setOpenedWith(readSelection())}
      sections={() => buildMenuSections(actions, sendPage())}
    >
      {children}
    </ContextMenu>
  );
}
