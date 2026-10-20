import { type ZoomAction, zoomPercent } from "@exegol/shared";
import { cn } from "@exegol/ui";
import { Camera, ZoomIn, ZoomOut } from "lucide-react";
import { useContextMenu } from "../../hooks/use-context-menu";
import { useFittedMenu } from "../../hooks/use-fitted-menu";
import { appKeys } from "../../lib/keymap";

export type ScreenshotTarget = "file" | "clipboard";

const iconButton =
  "flex h-5 w-5 items-center justify-center rounded text-text-muted transition-colors hover:bg-white/10 hover:text-text-primary";

/** Zoom out / the percent (click resets) / zoom in */
export function ZoomControls({
  zoom,
  onZoom,
}: {
  zoom: number;
  onZoom: (action: ZoomAction) => void;
}) {
  return (
    <div className="flex shrink-0 items-center">
      <button
        type="button"
        onClick={() => onZoom("out")}
        className={iconButton}
        title={`Zoom out (${appKeys("Cmd+-")})`}
      >
        <ZoomOut className="h-3 w-3" />
      </button>
      <button
        type="button"
        onClick={() => onZoom("reset")}
        className={cn(
          "rounded px-0.5 text-[9px] tabular-nums hover:bg-white/10",
          zoom === 1 ? "text-text-muted" : "text-accent",
        )}
        title={`Reset zoom (${appKeys("Cmd+0")})`}
      >
        {zoomPercent(zoom)}%
      </button>
      <button
        type="button"
        onClick={() => onZoom("in")}
        className={iconButton}
        title={`Zoom in (${appKeys("Cmd+=")})`}
      >
        <ZoomIn className="h-3 w-3" />
      </button>
    </div>
  );
}

const SHOTS: { label: string; target: ScreenshotTarget; fullPage: boolean }[] = [
  { label: "Save visible area...", target: "file", fullPage: false },
  { label: "Save full page...", target: "file", fullPage: true },
  { label: "Copy visible area", target: "clipboard", fullPage: false },
];

/** Camera button: the page as an image, to a file or the clipboard */
export function ScreenshotMenu({
  onScreenshot,
}: {
  onScreenshot: (target: ScreenshotTarget, fullPage: boolean) => void;
}) {
  const { contextMenu: menu, menuRef, handleContextMenu, closeContextMenu } = useContextMenu();
  const menuStyle = useFittedMenu(menuRef, menu);
  return (
    <>
      <button
        type="button"
        // Own the mousedown so the outside-click close does not reopen it on the same click
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => (menu ? closeContextMenu() : handleContextMenu(e))}
        className={iconButton}
        title="Screenshot"
      >
        <Camera className="h-3 w-3" />
      </button>
      {menu && (
        <div
          ref={menuRef}
          className="fixed z-50 min-w-[170px] rounded-lg border py-1 shadow-2xl"
          style={{ ...menuStyle, background: "var(--bg-secondary)", borderColor: "var(--border)" }}
        >
          {SHOTS.map((s) => (
            <button
              key={s.label}
              type="button"
              onClick={() => {
                closeContextMenu();
                onScreenshot(s.target, s.fullPage);
              }}
              className="flex w-full rounded px-2.5 py-1.5 text-left text-[11px] text-text-secondary hover:bg-white/10"
            >
              {s.label}
            </button>
          ))}
        </div>
      )}
    </>
  );
}
