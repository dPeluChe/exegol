import type { ViewEntry } from "@exegol/shared";
import { cn } from "@exegol/ui";
import { Ban, ExternalLink, FileCheck2, Loader2, LogIn, TriangleAlert } from "lucide-react";
import { memo } from "react";
import { useViewThumb } from "../../hooks/use-views";
import { CARD_LABEL_HEIGHT } from "../../lib/views-canvas";

function Badge({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <span title={title} className="flex shrink-0 items-center gap-0.5 text-[10px] text-text-muted">
      {children}
    </span>
  );
}

const ICON = "h-3 w-3";

export const ViewCard = memo(function ViewCard({
  projectId,
  view,
  x,
  y,
  width,
  height,
  selected,
  linked,
  onSelect,
}: {
  projectId: string;
  view: ViewEntry;
  x: number;
  y: number;
  width: number;
  height: number;
  selected: boolean;
  /** A link of the selected view ends here */
  linked: boolean;
  onSelect: (path: string) => void;
}) {
  const thumb = useViewThumb(projectId, view.path, view.shot);
  const external = view.externalHosts?.length ?? 0;
  return (
    <button
      type="button"
      data-view-card
      onClick={() => onSelect(view.path)}
      className={cn(
        "absolute flex flex-col overflow-hidden rounded-lg border bg-bg-secondary text-left",
        selected
          ? "border-accent ring-2 ring-accent/40"
          : linked
            ? "border-accent/60"
            : "border-border",
      )}
      style={{ left: x, top: y, width, height }}
    >
      <div className="relative min-h-0 flex-1 bg-bg-tertiary">
        {thumb.data ? (
          <img
            src={thumb.data}
            alt=""
            draggable={false}
            className="block h-full w-full object-cover object-top"
          />
        ) : (
          <div className="flex h-full items-center justify-center text-text-muted">
            {view.status === "loading" && <Loader2 className="h-4 w-4 animate-spin" />}
            {view.status === "failed" && <TriangleAlert className="h-4 w-4" />}
          </div>
        )}
        {view.cut && (
          <div className="absolute inset-x-0 bottom-0 h-3 bg-gradient-to-t from-bg-secondary to-transparent" />
        )}
      </div>
      <div
        className="flex flex-col justify-center gap-0.5 border-t border-border px-2"
        style={{ height: CARD_LABEL_HEIGHT }}
      >
        <span className="truncate font-mono text-[11px] text-text-primary" title={view.path}>
          {view.path}
        </span>
        <div className="flex items-center gap-2 overflow-hidden">
          {view.status === "redirected" && (
            <Badge title={`Redirected to ${view.finalPath}`}>
              <LogIn className={ICON} />
              <span className="max-w-24 truncate">{view.finalPath}</span>
            </Badge>
          )}
          {view.status === "failed" && (
            <Badge title="The page did not load">
              <TriangleAlert className={ICON} />
              {view.http || "failed"}
            </Badge>
          )}
          {view.inSitemap && (
            <Badge title="Listed in the sitemap">
              <FileCheck2 className={ICON} />
              sitemap
            </Badge>
          )}
          {view.robotsBlocked && (
            <Badge title="robots.txt keeps crawlers out of this path">
              <Ban className={ICON} />
              robots
            </Badge>
          )}
          {external > 0 && (
            <Badge
              title={`${external} outside site(s) linked, ${view.newTabLinks ?? 0} link(s) open a new tab`}
            >
              <ExternalLink className={ICON} />
              {external}
            </Badge>
          )}
        </div>
      </div>
    </button>
  );
});
