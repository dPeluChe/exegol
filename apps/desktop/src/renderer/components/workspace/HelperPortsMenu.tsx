import { useContextMenu } from "../../hooks/use-context-menu";
import { useFittedMenu } from "../../hooks/use-fitted-menu";
import type { PortInfo } from "../../hooks/use-trpc-scheduler";

export interface HelperPort {
  port: PortInfo;
  note: string;
}

/** "+N" after the page chips: the dev server's other ports, each with what it is */
export function HelperPortsMenu({
  helpers,
  onNavigateToPort,
}: {
  helpers: HelperPort[];
  onNavigateToPort: (port: number) => void;
}) {
  const { contextMenu: menu, menuRef, handleContextMenu, closeContextMenu } = useContextMenu();
  const menuStyle = useFittedMenu(menuRef, menu);
  if (helpers.length === 0) return null;
  return (
    <>
      <button
        type="button"
        // Own the mousedown so the outside-click close does not reopen it on the same click
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => (menu ? closeContextMenu() : handleContextMenu(e))}
        className="rounded px-1 py-0.5 text-[9px] text-text-muted hover:bg-white/10 hover:text-text-primary"
        title="Other ports the dev server opened"
      >
        +{helpers.length}
      </button>
      {menu && (
        <div
          ref={menuRef}
          className="fixed z-50 min-w-[240px] rounded-lg border py-1 shadow-2xl"
          style={{ ...menuStyle, background: "var(--bg-secondary)", borderColor: "var(--border)" }}
        >
          <div className="px-2.5 pt-0.5 pb-1 text-[10px] text-text-muted">
            Not pages: ports the dev server uses for itself
          </div>
          {helpers.map(({ port: p, note }) => (
            <button
              key={p.port}
              type="button"
              onClick={() => {
                onNavigateToPort(p.port);
                closeContextMenu();
              }}
              className="flex w-full items-baseline gap-2.5 rounded px-2.5 py-1.5 text-left text-[11px] text-text-secondary hover:bg-white/10"
              title={p.pid ? `PID ${p.pid} (${p.process})` : undefined}
            >
              <span className="w-10 shrink-0 tabular-nums text-text-primary">{p.port}</span>
              <span className="flex-1">{note}</span>
            </button>
          ))}
        </div>
      )}
    </>
  );
}
