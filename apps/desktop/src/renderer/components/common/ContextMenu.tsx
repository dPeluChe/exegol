import { useContextMenu } from "../../hooks/use-context-menu";
import { useFittedMenu } from "../../hooks/use-fitted-menu";
import { appKeys } from "../../lib/keymap";

export interface MenuItem {
  /** React key when labels can repeat (two tabs with one name) */
  id?: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  /** macOS notation; shown through lib/keymap for the platform */
  shortcut?: string;
  action: () => void;
  danger?: boolean;
}

export interface MenuSection {
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

/**
 * Right-click menu around `children` (a `display: contents` wrapper, so layout is untouched).
 * `sections` runs only while the menu is open: it reads state of that moment (selection, tabs).
 */
export function ContextMenu({
  sections,
  children,
}: {
  sections: () => MenuSection[];
  children: React.ReactNode;
}) {
  const { contextMenu: menu, menuRef, handleContextMenu, closeContextMenu } = useContextMenu();
  const menuStyle = useFittedMenu(menuRef, menu);
  const shown = menu ? sections().filter((s) => s.items.length > 0) : [];

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
          {shown.map((section, si) => (
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
