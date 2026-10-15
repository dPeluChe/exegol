import {
  ArrowDownToLine,
  ArrowUpToLine,
  ChevronRight,
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
import { useContextMenu } from "../../hooks/use-context-menu";
import { useFittedMenu } from "../../hooks/use-fitted-menu";
import { appKeys } from "../../lib/keymap";
import { movePane, paneMoveTargets } from "../../lib/move-pane";
import type { PaneType } from "../../stores/workspace";
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
  children: React.ReactNode;
}

interface MenuItem {
  /** React key when labels can repeat (two tabs with one name) */
  id?: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  shortcut?: string;
  action: () => void;
  danger?: boolean;
  /** Opens a page of the menu instead of closing it */
  submenu?: boolean;
}

interface MenuSection {
  items: MenuItem[];
}

function MenuItemButton({ item, onClose }: { item: MenuItem; onClose: () => void }) {
  return (
    <button
      type="button"
      onClick={() => {
        item.action();
        if (!item.submenu) onClose();
      }}
      className={`flex w-full items-center gap-2.5 rounded px-2.5 py-1.5 text-[11px] transition-colors ${
        item.danger ? "text-error hover:bg-error/10" : "text-text-secondary hover:bg-white/10"
      }`}
    >
      <item.icon className="h-3.5 w-3.5 shrink-0" />
      <span className="flex-1 text-left">{item.label}</span>
      {item.shortcut && (
        <span className="text-[10px] text-text-muted">{appKeys(item.shortcut)}</span>
      )}
      {item.submenu && <ChevronRight className="h-3 w-3 text-text-muted" />}
    </button>
  );
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

function buildMenuSections(actions: MenuActions, onSendSelection?: () => void): MenuSection[] {
  const isTerminal = actions.paneType === "terminal";
  const send: MenuItem[] = onSendSelection
    ? [{ label: "Send selection to", icon: Send, action: onSendSelection, submenu: true }]
    : [];
  const candidates = [
    ...(isTerminal
      ? [[...send, ...clipboardSection(actions)], terminalActionsSection(actions)]
      : []),
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
  const { contextMenu: menu, menuRef, handleContextMenu, closeContextMenu } = useContextMenu();
  const menuStyle = useFittedMenu(menuRef, menu);
  const [sendOpen, setSendOpen] = useState(false);
  // The selection when the menu opened: a TUI repaint or mouse report can clear it before a pick
  const [openedWith, setOpenedWith] = useState("");
  const live = menu && actions.paneType === "terminal" ? selectionSourceFor(actions.paneId) : null;
  const source = live && {
    ...live,
    getSelection: () => live.getSelection() || openedWith,
  };
  const canSend = !!openedWith;
  // Built on open only: the move list reads the tabs and sessions of that moment
  const sections = menu
    ? buildMenuSections(actions, canSend ? () => setSendOpen(true) : undefined)
    : [];

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: context menu wrapper
    <div
      onContextMenu={(e) => {
        setSendOpen(false);
        // Read after xterm's own handler: a right-click on a word selects it
        setOpenedWith(
          actions.paneType === "terminal"
            ? (selectionSourceFor(actions.paneId)?.getSelection() ?? "")
            : "",
        );
        handleContextMenu(e);
      }}
      className="contents"
    >
      {children}

      {menu && (
        <div
          ref={menuRef}
          className="fixed z-50 min-w-[200px] rounded-lg border py-1 shadow-2xl"
          style={{
            ...menuStyle,
            background: "var(--bg-secondary)",
            borderColor: "var(--border)",
          }}
        >
          {sendOpen && source && (
            <SendSelectionMenu
              source={source}
              onBack={() => setSendOpen(false)}
              onDone={closeContextMenu}
            />
          )}
          {!sendOpen &&
            sections.map((section, si) => (
              <div key={section.items[0]?.id ?? section.items[0]?.label ?? si}>
                {si > 0 && (
                  <div className="my-1 border-t" style={{ borderColor: "var(--border)" }} />
                )}
                {section.items.map((item) => (
                  <MenuItemButton
                    key={item.id ?? item.label}
                    item={item}
                    onClose={closeContextMenu}
                  />
                ))}
              </div>
            ))}
        </div>
      )}
    </div>
  );
}
