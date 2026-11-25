import { viewCounts } from "@exegol/shared";
import { Button } from "@exegol/ui";
import { LayoutDashboard, Loader2, LogIn, Play, Square, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { usePanePolling, usePaneProject } from "../../contexts/ProjectScope";
import { useViewServers, useViews } from "../../hooks/use-views";
import { splitWithBrowser } from "../../lib/split-terminal";
import { trpcMutate } from "../../lib/trpc-client";
import { toastError } from "../../stores/toasts";
import { useWorkspaceStore } from "../../stores/workspace";
import { layoutHasPane, pwOf } from "../../stores/workspace/helpers";
import { EmptyState } from "../common";
import { ViewDetails } from "./ViewDetails";
import { ViewLightbox } from "./ViewLightbox";
import { ViewsCanvas } from "./ViewsCanvas";

const Chip = ({ children }: { children: React.ReactNode }) => (
  <span className="rounded border border-border px-1.5 py-0.5 text-[10px] text-text-muted">
    {children}
  </span>
);

/** Every view of the project's running web app as a tree of captures (T228) */
export function ViewsPane({ paneId }: { paneId: string }) {
  const { projectId } = usePaneProject();
  return projectId ? <Views key={projectId} projectId={projectId} paneId={paneId} /> : null;
}

function Views({ projectId, paneId }: { projectId: string; paneId: string }) {
  const { data: state } = useViews(projectId);
  const servers = useViewServers(projectId);
  const [port, setPort] = useState<number | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  // With its pass: a later pass that finds the same path must not bring the capture back up
  const [enlarged, setEnlarged] = useState<{ path: string; run: number } | null>(null);

  const ports = servers.data ?? [];
  const statePort = state?.base ? Number(new URL(state.base).port) : null;
  const chosen = port ?? statePort ?? ports[0] ?? null;
  const start = (on: number) =>
    trpcMutate("views.start", { projectId, port: on }).catch(
      toastError("Could not start the pass"),
    );

  // Seeing the pane for the first time is what runs a pass (one restored in a hidden tab waits,
  // and Clear stays cleared); main skips it when one ran or runs
  const visible = usePanePolling();
  const asked = useRef(false);
  useEffect(() => {
    if (!visible || asked.current) return;
    asked.current = true;
    void trpcMutate("views.start", { projectId, ifEmpty: true }).catch(() => undefined);
  }, [visible, projectId]);

  const resume = (retry: boolean) =>
    trpcMutate("views.resume", { projectId, retry }).catch(toastError("Could not continue"));
  const openLive = (url: string) => {
    const pw = pwOf(useWorkspaceStore.getState(), projectId);
    const tab = pw.tabs.find((t) => layoutHasPane(t.layout, paneId));
    if (tab) splitWithBrowser(tab.id, paneId, "horizontal", url);
  };

  const views = state?.views ?? [];
  const counts = viewCounts(views);
  const picked = views.find((v) => v.path === selected);
  const large =
    enlarged && enlarged.run === state?.run
      ? views.find((v) => v.path === enlarged.path)
      : undefined;
  const enlarge = (path: string) => setEnlarged({ path, run: state?.run ?? 0 });
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border px-3 py-1.5">
        <LayoutDashboard className="h-3.5 w-3.5 text-text-muted" />
        <span className="text-xs font-medium text-text-primary">Views</span>
        {ports.length === 0 && (
          // Windows cannot list listening ports yet, and a server elsewhere is not found either
          <input
            type="number"
            min={1}
            max={65_535}
            aria-label="Port"
            placeholder="Port"
            className="w-20 rounded border border-border bg-bg-secondary px-1.5 py-0.5 text-[11px] text-text-secondary"
            value={port ?? ""}
            disabled={state?.running}
            onChange={(e) => {
              const n = Number(e.target.value);
              setPort(Number.isInteger(n) && n >= 1 && n <= 65_535 ? n : null);
            }}
          />
        )}
        {ports.length > 0 && (
          <select
            aria-label="Local server"
            className="rounded border border-border bg-bg-secondary px-1.5 py-0.5 text-[11px] text-text-secondary"
            value={chosen ?? ""}
            disabled={state?.running}
            onChange={(e) => setPort(Number(e.target.value))}
          >
            {ports.map((p) => (
              <option key={p} value={p}>
                localhost:{p}
              </option>
            ))}
          </select>
        )}
        {state?.running ? (
          <Button
            size="sm"
            variant="outline"
            className="h-6 gap-1.5 px-2 text-[11px]"
            onClick={() => trpcMutate("views.stop", { projectId })}
          >
            <Square className="h-3 w-3" />
            Stop
          </Button>
        ) : (
          <Button
            size="sm"
            variant="outline"
            className="h-6 gap-1.5 px-2 text-[11px]"
            // A view being captured on its own: a pass waits for it
            disabled={chosen === null || views.some((v) => v.status === "loading")}
            onClick={() => chosen !== null && start(chosen)}
          >
            <Play className="h-3 w-3" />
            {views.length > 0 ? "Capture again" : "Capture"}
          </Button>
        )}
        {state?.running && !state.hold && (
          <Loader2 className="h-3.5 w-3.5 animate-spin text-text-muted" />
        )}
        {views.length > 0 && (
          <span className="text-[11px] text-text-muted">
            {counts.total} view{counts.total === 1 ? "" : "s"}
            {counts.left > 0 && `, ${counts.left} to go`}
            {counts.redirected > 0 && `, ${counts.redirected} redirected`}
            {counts.failed > 0 && `, ${counts.failed} failed`}
          </span>
        )}
        <div className="ml-auto flex items-center gap-1.5">
          {state?.sitemap === "found" && <Chip>sitemap</Chip>}
          {state?.sitemap === "missing" && <Chip>no sitemap</Chip>}
          {state?.robots === "found" && <Chip>robots.txt</Chip>}
          {(state?.patterns.length ?? 0) > 0 && (
            <span title={state?.patterns.join("\n")}>
              <Chip>{state?.patterns.length} routes need values</Chip>
            </span>
          )}
          {views.length > 0 && !state?.running && (
            <button
              type="button"
              title="Delete the captures"
              className="rounded p-1 text-text-muted hover:bg-bg-tertiary"
              onClick={() => {
                setSelected(null);
                void trpcMutate("views.clear", { projectId });
              }}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>
      {state?.hold && (
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border bg-bg-secondary px-3 py-2">
          <LogIn className="h-3.5 w-3.5 shrink-0 text-accent" />
          <span className="text-xs text-text-primary">
            Paused: {state.hold.views === 1 ? "a view" : `${state.hold.views} views`} led to{" "}
            <span className="font-mono">{state.hold.path}</span>. If it is a login, log in and
            continue.
          </span>
          <div className="ml-auto flex items-center gap-1.5">
            <Button
              size="sm"
              variant="outline"
              className="h-6 px-2 text-[11px]"
              onClick={() => openLive(`${state.base}${state.hold?.path}`)}
            >
              Open that page
            </Button>
            <Button size="sm" className="h-6 px-2 text-[11px]" onClick={() => resume(true)}>
              I logged in, continue
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-6 px-2 text-[11px]"
              onClick={() => resume(false)}
            >
              Continue without it
            </Button>
          </div>
        </div>
      )}
      <div className="relative flex min-h-0 flex-1">
        {large && (
          <ViewLightbox projectId={projectId} view={large} onClose={() => setEnlarged(null)} />
        )}
        {views.length > 0 && state ? (
          <>
            <ViewsCanvas
              projectId={projectId}
              views={views}
              selected={selected}
              running={!!state.running}
              onSelect={setSelected}
              onEnlarge={enlarge}
            />
            {picked && (
              <ViewDetails
                projectId={projectId}
                state={state}
                view={picked}
                onSelect={setSelected}
                onOpenLive={openLive}
                onEnlarge={() => enlarge(picked.path)}
              />
            )}
          </>
        ) : (
          <EmptyState
            className="h-full w-full"
            icon={<LayoutDashboard className="h-7 w-7 text-text-muted" />}
            title={ports.length > 0 ? "No captures yet" : "No local server is running"}
            description={
              ports.length > 0
                ? "A pass loads every page of the running app and captures it. Nothing is clicked."
                : "Start the project's dev server in a terminal of this project and check again, or type its port above."
            }
            action={
              ports.length > 0
                ? undefined
                : { label: "Check again", onClick: () => void servers.refetch() }
            }
          />
        )}
      </div>
    </div>
  );
}
