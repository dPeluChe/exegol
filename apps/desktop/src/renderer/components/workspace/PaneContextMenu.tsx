import {
  ArrowDownToLine,
  ArrowUpToLine,
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
  Smartphone,
  TerminalSquare,
  Trash2,
} from "lucide-react";
import { useContextMenu } from "../../hooks/use-context-menu";
import { useFittedMenu } from "../../hooks/use-fitted-menu";
import { useSimulatorAvailable } from "../../hooks/use-simulator";
import { appKeys } from "../../lib/keymap";
import { movePane, paneMoveTargets } from "../../lib/move-pane";
import type { PaneType } from "../../stores/workspace";

interface PaneContextMenuProps {
  tabId: string;
  paneId: string;
  paneType: PaneType;
  agentId?: string;
  isSplitPane: boolean;
  /** macOS with Xcode: offers Split with Simulator */
  simulator?: boolean;
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
        onClose();
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
  simulator,
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
    ...(simulator
      ? [
          {
            label: "Split with Simulator",
            icon: Smartphone,
            action: () => onSplit("horizontal", "simulator"),
          },
        ]
      : []),
    ...(onFloat ? [{ label: "Float to Window", icon: PictureInPicture2, action: onFloat }] : []),
    ...(isSplitPane ? [{ label: "Equalize Splits", icon: Equal, action: onEqualize }] : []),
  ];
}

function buildMenuSections(actions: MenuActions): MenuSection[] {
  const isTerminal = actions.paneType === "terminal";
  const candidates = [
    ...(isTerminal ? [clipboardSection(actions), terminalActionsSection(actions)] : []),
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
  const simulator = useSimulatorAvailable();
  // Built on open only: the move list reads the tabs and sessions of that moment
  const sections = menu ? buildMenuSections({ ...actions, simulator }) : [];

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: context menu wrapper
    <div onContextMenu={handleContextMenu} className="contents">
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
          {sections.map((section, si) => (
            <div key={section.items[0]?.id ?? section.items[0]?.label ?? si}>
              {si > 0 && <div className="my-1 border-t" style={{ borderColor: "var(--border)" }} />}
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
