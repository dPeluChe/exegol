import {
  ArrowDownToLine,
  ArrowUpToLine,
  Clipboard,
  ClipboardPaste,
  Columns,
  Globe,
  MoveRight,
  Rows,
  Trash2,
  X,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { PaneType } from "../../stores/workspace";

interface MenuPosition {
  x: number;
  y: number;
}

interface PaneContextMenuProps {
  tabId: string;
  paneId: string;
  paneType: PaneType;
  agentId?: string;
  isSplitPane: boolean;
  onSplit: (direction: "horizontal" | "vertical", newType?: PaneType) => void;
  onExtractToTab: () => void;
  onClose: () => void;
  onCopy?: () => void;
  onPaste?: () => void;
  onClear?: () => void;
  onScrollTop?: () => void;
  onScrollBottom?: () => void;
  children: React.ReactNode;
}

interface MenuItem {
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
      {item.shortcut && <span className="text-[10px] text-text-muted">{item.shortcut}</span>}
    </button>
  );
}

export function PaneContextMenu({
  paneType,
  isSplitPane,
  onSplit,
  onExtractToTab,
  onClose,
  onCopy,
  onPaste,
  onClear,
  onScrollTop,
  onScrollBottom,
  children,
}: PaneContextMenuProps) {
  const [menu, setMenu] = useState<MenuPosition | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setMenu({ x: e.clientX, y: e.clientY });
  }, []);

  const closeMenu = useCallback(() => setMenu(null), []);

  useEffect(() => {
    if (!menu) return;
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) closeMenu();
    };
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeMenu();
    };
    window.addEventListener("mousedown", handleClick);
    window.addEventListener("keydown", handleEsc);
    return () => {
      window.removeEventListener("mousedown", handleClick);
      window.removeEventListener("keydown", handleEsc);
    };
  }, [menu, closeMenu]);

  const isTerminal = paneType === "terminal";

  const sections: MenuSection[] = [];

  // Terminal clipboard section
  if (isTerminal && (onCopy || onPaste)) {
    const items: MenuItem[] = [];
    if (onCopy) items.push({ label: "Copy", icon: Clipboard, shortcut: "⌘C", action: onCopy });
    if (onPaste)
      items.push({ label: "Paste", icon: ClipboardPaste, shortcut: "⌘V", action: onPaste });
    if (items.length > 0) sections.push({ items });
  }

  // Terminal actions section
  if (isTerminal) {
    const items: MenuItem[] = [];
    if (onClear) items.push({ label: "Clear Terminal", icon: X, shortcut: "⌘K", action: onClear });
    if (onScrollTop)
      items.push({ label: "Scroll to Top", icon: ArrowUpToLine, action: onScrollTop });
    if (onScrollBottom)
      items.push({ label: "Scroll to Bottom", icon: ArrowDownToLine, action: onScrollBottom });
    if (items.length > 0) sections.push({ items });
  }

  // Split section (all pane types)
  sections.push({
    items: [
      {
        label: "Split Horizontally",
        icon: Columns,
        shortcut: "⌘D",
        action: () => onSplit("horizontal"),
      },
      { label: "Split Vertically", icon: Rows, shortcut: "⌘⇧D", action: () => onSplit("vertical") },
      { label: "Split with Browser", icon: Globe, action: () => onSplit("horizontal", "browser") },
      ...(isSplitPane
        ? [{ label: "Move to New Tab", icon: MoveRight, action: onExtractToTab }]
        : []),
    ],
  });

  // Close section
  sections.push({
    items: [
      {
        label: `Close ${isTerminal ? "Terminal" : "Pane"}`,
        icon: Trash2,
        action: onClose,
        danger: true,
      },
    ],
  });

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: context menu wrapper
    <div onContextMenu={handleContextMenu} className="contents">
      {children}

      {menu && (
        <div
          ref={menuRef}
          className="fixed z-50 min-w-[200px] rounded-lg border py-1 shadow-2xl"
          style={{
            left: menu.x,
            top: menu.y,
            background: "var(--bg-secondary)",
            borderColor: "var(--border)",
          }}
        >
          {sections.map((section, si) => (
            <div key={section.items[0]?.label ?? si}>
              {si > 0 && <div className="my-1 border-t" style={{ borderColor: "var(--border)" }} />}
              {section.items.map((item) => (
                <MenuItemButton key={item.label} item={item} onClose={closeMenu} />
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
