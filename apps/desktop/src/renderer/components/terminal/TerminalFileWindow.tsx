import { Code2, ExternalLink, FolderSearch, PanelRight, X } from "lucide-react";
import { memo, type PointerEvent, useRef, useState, useSyncExternalStore } from "react";
import { useMountEffect } from "../../hooks/use-mount-effect";
import { type FileContent, useProjects, useTerminalLinkFile } from "../../hooks/use-trpc";
import {
  clampRect,
  defaultRect,
  displayPath,
  dragRect,
  type WindowRect,
} from "../../lib/file-window";
import { appKeys, editKeys } from "../../lib/keymap";
import { useAgentStore } from "../../stores/agents";
import {
  closeFileWindow,
  type TerminalLinkPeek,
  useFileWindowStore,
  useTerminalLinkStore,
} from "../../stores/terminal-links";
import { action, FilePreview } from "../workspace/FilePreview";
import { openPeekInFilesPane, openPeekInIde, openPeekWith } from "./terminal-link-actions";

const onResize = (listener: () => void) => {
  window.addEventListener("resize", listener);
  return () => window.removeEventListener("resize", listener);
};

let viewport = { width: window.innerWidth, height: window.innerHeight };
const viewportSnapshot = () => {
  if (viewport.width !== window.innerWidth || viewport.height !== window.innerHeight) {
    viewport = { width: window.innerWidth, height: window.innerHeight };
  }
  return viewport;
};

const useViewport = () => useSyncExternalStore(onResize, viewportSnapshot);

/**
 * A file clicked in a terminal, in a floating window over the workspace: no backdrop, so the
 * terminal behind stays visible and typable. One at a time; another click replaces it.
 */
export function TerminalFileWindow() {
  const peek = useTerminalLinkStore((s) => s.peek);
  if (!peek) return null;
  return <FileWindow key={`${peek.agentId}:${peek.text}:${peek.line ?? ""}`} peek={peek} />;
}

interface Drag {
  pointerId: number;
  kind: "move" | "resize";
  x: number;
  y: number;
  start: WindowRect;
}

function FileWindow({ peek }: { peek: TerminalLinkPeek }) {
  const { data, error } = useTerminalLinkFile({
    agentId: peek.agentId,
    cwd: peek.cwd,
    text: peek.text,
  });
  const projectId = useAgentStore((s) => s.agents[peek.agentId]?.projectId);
  const { data: projects } = useProjects();
  const projectPath = projects?.find((p) => p.id === projectId)?.path;
  const path = data?.path ?? peek.text;
  const label = displayPath(path, projectPath);

  const viewport = useViewport();
  const stored = useFileWindowStore((s) => s.rect);
  const setStored = useFileWindowStore((s) => s.setRect);
  const [live, setLive] = useState<WindowRect | null>(null);
  const rect = clampRect(live ?? stored ?? defaultRect(viewport), viewport);
  const dragRef = useRef<Drag | null>(null);
  const rootRef = useRef<HTMLElement>(null);

  // Takes the keyboard from the terminal the click came from, so Esc closes this, not the CLI
  useMountEffect(() => {
    const id = requestAnimationFrame(() => rootRef.current?.focus());
    return () => cancelAnimationFrame(id);
  });

  const startDrag = (kind: Drag["kind"]) => (e: PointerEvent<HTMLElement>) => {
    if (e.button !== 0) return;
    if (kind === "move" && (e.target as Element).closest("button")) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = { pointerId: e.pointerId, kind, x: e.clientX, y: e.clientY, start: rect };
  };
  const moveDrag = (e: PointerEvent<HTMLElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    setLive(dragRect(drag.start, drag.kind, e.clientX - drag.x, e.clientY - drag.y, viewport));
  };
  const endDrag = (e: PointerEvent<HTMLElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    dragRef.current = null;
    if (live) setStored(live);
    setLive(null);
  };
  const dragHandlers = (kind: Drag["kind"]) => ({
    onPointerDown: startDrag(kind),
    onPointerMove: moveDrag,
    onPointerUp: endDrag,
    onPointerCancel: endDrag,
  });

  return (
    <section
      ref={rootRef}
      tabIndex={-1}
      aria-label={`File ${label}`}
      data-file-window
      className="titlebar-no-drag fixed z-40 flex flex-col overflow-hidden rounded-lg border border-border bg-bg-primary shadow-2xl outline-none"
      style={{ left: rect.x, top: rect.y, width: rect.width, height: rect.height }}
      onKeyDown={(e) => {
        if (e.key !== "Escape" || e.defaultPrevented) return;
        e.preventDefault();
        closeFileWindow();
      }}
    >
      <header
        className="flex h-8 shrink-0 cursor-move select-none items-center gap-1 border-b border-border bg-bg-secondary px-2"
        {...dragHandlers("move")}
      >
        <span
          className="min-w-0 flex-1 truncate font-mono text-[11px] text-text-secondary"
          title={path}
        >
          {label}
          {peek.line ? `:${peek.line}` : ""}
        </span>
        <button
          type="button"
          className={action}
          disabled={!data}
          onClick={() => data && openPeekInFilesPane(peek, data.path, projectPath)}
          title="Open in a Files pane beside the terminal"
        >
          <PanelRight className="h-3 w-3" />
          Files pane
        </button>
        <button
          type="button"
          className={action}
          onClick={() => openPeekInIde(peek)}
          title={`Open in the IDE (${editKeys("Cmd+click")} on the link)`}
        >
          <Code2 className="h-3 w-3" />
          Editor
        </button>
        <button
          type="button"
          className={action}
          onClick={() => openPeekWith(peek, "external")}
          title="Open with its default app"
        >
          <ExternalLink className="h-3 w-3" />
        </button>
        <button
          type="button"
          className={action}
          onClick={() => openPeekWith(peek, "reveal")}
          title="Reveal in Finder"
        >
          <FolderSearch className="h-3 w-3" />
        </button>
        <button
          type="button"
          className={action}
          onClick={closeFileWindow}
          title={`Close (Esc, ${appKeys("Cmd+W")})`}
          aria-label="Close"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </header>
      <div className="flex min-h-0 flex-1">
        <FileWindowBody peek={peek} path={path} file={data} error={error} />
      </div>
      <div
        aria-hidden
        className="absolute right-0 bottom-0 h-3 w-3 cursor-nwse-resize"
        {...dragHandlers("resize")}
      />
    </section>
  );
}

// Memo: a drag re-renders the window on every pointermove, the preview needs none of it
const FileWindowBody = memo(function FileWindowBody({
  peek,
  path,
  file,
  error,
}: {
  peek: TerminalLinkPeek;
  path: string;
  file: FileContent | undefined;
  error: unknown;
}) {
  return (
    <FilePreview
      path={path}
      file={file}
      error={error}
      revealLine={peek.line}
      readOnly
      toolbar={false}
      onOpenExternal={() => openPeekWith(peek, "external")}
    />
  );
});
