import { cn } from "@exegol/ui";
import { Globe, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useProjectContext } from "../../contexts/ProjectContext";
import {
  type PortInfo,
  usePreferredPort,
  useProjectPorts,
  useSetPreferredPort,
} from "../../hooks/use-trpc-scheduler";
import type { Pane } from "../../stores/workspace";
import { useWorkspaceStore } from "../../stores/workspace";

// ─── Browser Pane ──────────────────────────────────────────────────────────

export function BrowserPane({ pane, paneId }: { pane: Pane; paneId: string }) {
  const { projectId, project } = useProjectContext();
  const { data: ports } = useProjectPorts(project?.path ?? null);
  const { data: preferredPort } = usePreferredPort(projectId);
  const setPreferred = useSetPreferredPort();
  const updatePane = useWorkspaceStore((s) => s.updatePane);
  const setFocusedPane = useWorkspaceStore((s) => s.setFocusedPane);

  // Deduplicate ports, prefer runtime over config
  const uniquePorts = useMemo(() => {
    if (!ports) return [];
    const map = new Map<number, PortInfo>();
    for (const p of ports) {
      const existing = map.get(p.port);
      if (!existing || (p.source === "runtime" && existing.source === "config")) {
        map.set(p.port, p);
      }
    }
    return Array.from(map.values());
  }, [ports]);

  const initUrl = pane.url ?? "http://localhost:3000";
  const [urlInput, setUrlInput] = useState(initUrl);
  const [currentUrl, setCurrentUrl] = useState(initUrl);
  const [didAutoSync, setDidAutoSync] = useState(!!pane.url);

  // Auto-sync to preferred or first detected port on initial load (once)
  useEffect(() => {
    if (didAutoSync) return;
    const port =
      preferredPort ??
      uniquePorts.find((p) => p.source === "runtime")?.port ??
      uniquePorts[0]?.port;
    if (port) {
      const url = `http://localhost:${port}`;
      setUrlInput(url);
      setCurrentUrl(url);
      updatePane(pane.id, { url });
      setDidAutoSync(true);
    }
  }, [didAutoSync, preferredPort, uniquePorts, pane.id, updatePane]);

  const navigate = useCallback(() => {
    let url = urlInput.trim();
    if (url && !url.startsWith("http://") && !url.startsWith("https://")) {
      url = `http://${url}`;
    }
    setCurrentUrl(url);
    updatePane(pane.id, { url });
  }, [urlInput, pane.id, updatePane]);

  const navigateToPort = useCallback(
    (port: number) => {
      const url = `http://localhost:${port}`;
      setUrlInput(url);
      setCurrentUrl(url);
      updatePane(pane.id, { url });
    },
    [pane.id, updatePane],
  );

  const focusedPaneId = useWorkspaceStore((s) => s.focusedPaneId);
  const isFocused = focusedPaneId === paneId;

  return (
    <div role="none" className="flex h-full flex-col" onMouseDown={() => setFocusedPane(paneId)}>
      {/* URL bar */}
      <div className="flex h-8 shrink-0 items-center gap-1 border-b border-border bg-bg-secondary px-2">
        <Globe className="h-3 w-3 shrink-0 text-text-muted" />
        {uniquePorts.length > 0 && (
          <div className="flex shrink-0 items-center gap-0.5">
            {uniquePorts.map((p) => (
              <button
                key={p.port}
                type="button"
                onClick={() => navigateToPort(p.port)}
                className={cn(
                  "flex items-center gap-0.5 rounded px-1 py-0.5 text-[9px] transition-colors",
                  currentUrl.includes(`:${p.port}`)
                    ? "bg-accent/20 text-accent"
                    : "text-text-muted hover:bg-white/10 hover:text-text-primary",
                )}
              >
                <span
                  className={cn(
                    "inline-block h-1.5 w-1.5 rounded-full",
                    p.source === "runtime" ? "bg-green-500" : "bg-zinc-500",
                  )}
                />
                {p.port}
                {projectId && (
                  <button
                    type="button"
                    className={cn(
                      "ml-0.5 cursor-pointer text-[8px]",
                      preferredPort === p.port ? "text-amber-400" : "text-text-muted/40",
                    )}
                    onClick={(e) => {
                      e.stopPropagation();
                      setPreferred.mutate({ projectId, port: p.port });
                    }}
                    title={preferredPort === p.port ? "Preferred port" : "Set as preferred"}
                  >
                    &#9733;
                  </button>
                )}
              </button>
            ))}
          </div>
        )}
        <input
          type="text"
          value={urlInput}
          onChange={(e) => setUrlInput(e.target.value)}
          onFocus={() => setFocusedPane(paneId)}
          onKeyDown={(e) => {
            if (e.key === "Enter") navigate();
          }}
          className="flex-1 bg-transparent text-[11px] text-text-primary outline-none placeholder:text-text-muted"
          placeholder="http://localhost:3000"
        />
        <button
          type="button"
          onClick={navigate}
          className="flex h-5 w-5 items-center justify-center rounded text-text-muted hover:bg-white/10 hover:text-text-primary"
          title="Refresh / Go"
        >
          <RefreshCw className="h-3 w-3" />
        </button>
      </div>
      {/* Webview with focus capture overlay when not active */}
      <div className="relative flex-1">
        <webview
          src={currentUrl}
          className="h-full w-full"
          /* @ts-expect-error Electron webview attributes */
          allowpopups="true"
        />
        {!isFocused && (
          <div
            role="none"
            className="absolute inset-0 z-10"
            onMouseDown={() => setFocusedPane(paneId)}
          />
        )}
      </div>
    </div>
  );
}
