import type { ViewEntry, ViewsState } from "@exegol/shared";
import { Button } from "@exegol/ui";
import {
  Copy,
  ExternalLink,
  FileImage,
  Maximize2,
  PanelRightOpen,
  RefreshCw,
  X,
} from "lucide-react";
import { useMemo } from "react";
import { trpcInvoke, trpcMutate } from "../../lib/trpc-client";
import { linkedFrom } from "../../lib/views-canvas";
import { toastError, toastSuccess } from "../../stores/toasts";

const SOURCE: Record<ViewEntry["sources"][number], string> = {
  files: "page file",
  links: "a link",
  sitemap: "sitemap",
};

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <h4 className="text-[10px] font-semibold uppercase tracking-wider text-text-muted">
        {title}
      </h4>
      {children}
    </div>
  );
}

function PathList({
  paths,
  onPick,
}: {
  paths: { path: string; note?: string }[];
  onPick?: (path: string) => void;
}) {
  return (
    <ul className="flex flex-col">
      {paths.map(({ path, note }) => (
        <li key={path} className="flex items-center gap-2 text-[11px]">
          {onPick ? (
            <button
              type="button"
              className="truncate font-mono text-text-secondary hover:text-accent"
              onClick={() => onPick(path)}
            >
              {path}
            </button>
          ) : (
            <span className="truncate font-mono text-text-secondary">{path}</span>
          )}
          {note && <span className="shrink-0 text-[10px] text-text-muted">{note}</span>}
        </li>
      ))}
    </ul>
  );
}

/** What the canvas knows about the selected view, with the ways to take it elsewhere */
export function ViewDetails({
  projectId,
  state,
  view,
  onSelect,
  onOpenLive,
  onEnlarge,
}: {
  projectId: string;
  state: ViewsState;
  view: ViewEntry;
  onSelect: (path: string | null) => void;
  onOpenLive: (url: string) => void;
  onEnlarge: () => void;
}) {
  const url = `${state.base ?? ""}${view.path}`;
  const known = useMemo(() => new Set(state.views.map((v) => v.path)), [state.views]);
  const from = useMemo(() => linkedFrom(state.views, view.path), [state.views, view.path]);
  const links = view.links ?? [];
  const input = { projectId, path: view.path };
  return (
    <aside className="flex w-80 shrink-0 flex-col gap-4 overflow-y-auto border-l border-border bg-bg-secondary p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="break-all font-mono text-xs text-text-primary">{view.path}</p>
          <p className="text-[11px] text-text-muted">
            Found by {view.sources.map((s) => SOURCE[s]).join(", ")}
            {view.status === "redirected" && `. Redirected to ${view.finalPath}`}
            {view.status === "failed" && `. Did not load${view.http ? ` (${view.http})` : ""}`}
            {view.cut && ". The page goes on below the capture"}
          </p>
        </div>
        <button
          type="button"
          title="Close"
          className="rounded p-1 text-text-muted hover:bg-bg-tertiary"
          onClick={() => onSelect(null)}
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="flex flex-wrap gap-1.5">
        <Button
          size="sm"
          variant="outline"
          className="gap-1.5"
          disabled={view.shot === undefined}
          onClick={onEnlarge}
        >
          <Maximize2 className="h-3.5 w-3.5" />
          Enlarge
        </Button>
        <Button size="sm" variant="outline" className="gap-1.5" onClick={() => onOpenLive(url)}>
          <PanelRightOpen className="h-3.5 w-3.5" />
          Open live
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="gap-1.5"
          disabled={!!state.running || view.status === "loading"}
          title="Load this page and capture it again"
          onClick={() =>
            trpcMutate("views.recapture", input).catch(toastError("Could not capture the view"))
          }
        >
          <RefreshCw className="h-3.5 w-3.5" />
          Capture again
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="gap-1.5"
          disabled={view.shot === undefined}
          onClick={() =>
            trpcMutate("views.copyImage", input)
              .then((ok) => ok && toastSuccess("Capture copied"))
              .catch(toastError("Could not copy the capture"))
          }
        >
          <Copy className="h-3.5 w-3.5" />
          Copy capture
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="gap-1.5"
          disabled={view.shot === undefined}
          title="The capture's file, to paste into an agent's prompt. It lasts until the next pass"
          onClick={() =>
            trpcInvoke<string | null>("views.file", input)
              .then(async (file) => {
                if (!file) return;
                await navigator.clipboard.writeText(file);
                toastSuccess("File path copied");
              })
              .catch(toastError("Could not copy the path"))
          }
        >
          <FileImage className="h-3.5 w-3.5" />
          Copy file path
        </Button>
      </div>
      <Section title="Checks">
        <p className="text-[11px] text-text-secondary">
          {state.sitemap === "found"
            ? view.inSitemap
              ? "Listed in the sitemap."
              : "Not in the sitemap."
            : "The site serves no sitemap."}{" "}
          {state.robots === "found"
            ? view.robotsBlocked
              ? "robots.txt keeps crawlers out."
              : "robots.txt allows crawlers."
            : "The site serves no robots.txt."}
        </p>
      </Section>
      {links.length > 0 && (
        <Section title={`Links to (${links.length})`}>
          <PathList
            paths={links.map((l) => ({
              path: l.to,
              note:
                [l.newTab && "new tab", !known.has(l.to) && "not captured"]
                  .filter(Boolean)
                  .join(", ") || undefined,
            }))}
            onPick={(path) => known.has(path) && onSelect(path)}
          />
        </Section>
      )}
      {(view.externalHosts?.length ?? 0) > 0 && (
        <Section title={`Leaves the site (${view.externalHosts?.length})`}>
          <ul className="flex flex-col text-[11px] text-text-secondary">
            {view.externalHosts?.map((host) => (
              <li key={host} className="flex items-center gap-1.5">
                <ExternalLink className="h-3 w-3 shrink-0 text-text-muted" />
                <span className="truncate">{host}</span>
              </li>
            ))}
          </ul>
          <p className="text-[10px] text-text-muted">
            {view.newTabLinks ?? 0} of this page's links open a new tab.
          </p>
        </Section>
      )}
      <Section title="Linked from">
        {from.length > 0 ? (
          <PathList paths={from.map((path) => ({ path }))} onPick={onSelect} />
        ) : (
          <p className="text-[11px] text-text-muted">No captured view links here.</p>
        )}
      </Section>
    </aside>
  );
}
