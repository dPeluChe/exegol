import { ExternalLink, FolderSearch, X } from "lucide-react";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { type FileContent, useWriteFile } from "../../hooks/use-trpc";
import { trpcMutate } from "../../lib/trpc-client";
import { ConfirmDialog } from "../common/ConfirmDialog";
import { formatBytes } from "./sections/resource-format";

const CodeViewer = lazy(() => import("./CodeViewer").then((m) => ({ default: m.CodeViewer })));

const openExternal = (path: string) => trpcMutate("files.openExternal", { path }).catch(() => {});
const reveal = (path: string) => trpcMutate("files.reveal", { path }).catch(() => {});

/** PDF bytes as a blob URL (a data: URL is refused for PDFs in frames). Made and
 *  revoked in one effect: a memo + cleanup pair lost the URL on StrictMode's remount */
function usePdfUrl(file: FileContent | undefined): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (file?.kind !== "pdf" || !file.base64) {
      setUrl(null);
      return;
    }
    const bytes = Uint8Array.from(atob(file.base64), (c) => c.charCodeAt(0));
    const next = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [file]);
  return url;
}

/**
 * The file viewer next to the tree. Images and PDFs render as themselves (they
 * used to open as mojibake in Monaco); other binaries and very large files
 * offer the default app and Finder. Text is editable: Save / Cmd+S, with a
 * check that nobody changed the file on disk in the meantime.
 */
export function FilePreview({
  path,
  file,
  error,
  onClose,
  revealLine,
  onDirtyChange,
}: {
  path: string;
  file: FileContent | undefined;
  error: unknown;
  onClose: () => void;
  /** A text search hit: scroll to this line */
  revealLine?: number;
  /** The explorer asks before switching files or closing with unsaved edits */
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const pdfUrl = usePdfUrl(file);
  const writeFile = useWriteFile();
  const [draft, setDraft] = useState<string | null>(null);
  // What the edit started from: the file query refetches on its own, so without
  // this an agent's change on disk would be overwritten without a word
  const baseRef = useRef<{ content: string; mtimeMs?: number } | null>(null);
  const [conflict, setConflict] = useState(false);
  const dirty = draft !== null && draft !== baseRef.current?.content;

  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

  const save = async (force = false) => {
    if (!dirty || draft === null || writeFile.isPending) return;
    try {
      await writeFile.mutateAsync({
        path,
        content: draft,
        expectedMtimeMs: force ? undefined : baseRef.current?.mtimeMs,
      });
      baseRef.current = null;
      setDraft(null);
    } catch (err) {
      // Main checks the mtime; the error code does not survive IPC, the message does
      if (String(err).includes("changed on disk")) setConflict(true);
    }
  };
  const saveError =
    writeFile.error && !String(writeFile.error).includes("changed on disk")
      ? writeFile.error.message
      : null;

  const action =
    "flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-text-muted hover:bg-white/10 hover:text-text-primary";

  let body: React.ReactNode;
  if (error) {
    body = (
      <Message>
        Cannot open this file: {error instanceof Error ? error.message : String(error)}
      </Message>
    );
  } else if (!file) {
    body = <Message>Loading...</Message>;
  } else if (file.kind === "image" && file.base64) {
    body = (
      <div className="flex h-full items-center justify-center overflow-auto bg-[repeating-conic-gradient(#ffffff08_0%_25%,transparent_0%_50%)] bg-[length:16px_16px] p-4">
        <img
          src={`data:${file.mime};base64,${file.base64}`}
          alt={path}
          className="max-h-full max-w-full object-contain"
        />
      </div>
    );
  } else if (file.kind === "pdf" && pdfUrl) {
    body = <iframe src={pdfUrl} title={path} className="h-full w-full border-0 bg-white" />;
  } else if (file.kind === "text") {
    body = (
      <Suspense fallback={<Message>Loading editor...</Message>}>
        <CodeViewer
          key={path}
          content={draft ?? file.content}
          fileName={path}
          revealLine={revealLine}
          onChange={(value) => {
            baseRef.current ??= { content: file.content, mtimeMs: file.mtimeMs };
            setDraft(value);
          }}
          onSave={save}
        />
      </Suspense>
    );
  } else {
    body = (
      <Message>
        {file.kind === "too-large"
          ? `Too large to preview (${formatBytes(file.size)}).`
          : "Binary file, no preview."}
        <button
          type="button"
          onClick={() => openExternal(path)}
          className="mt-2 text-accent hover:underline"
        >
          Open with its default app
        </button>
      </Message>
    );
  }

  return (
    // Esc only from inside the viewer: a window listener closed it while typing in a terminal
    // biome-ignore lint/a11y/noStaticElementInteractions: keyboard shortcut scope for the viewer
    <div
      className="flex min-w-0 flex-1 flex-col"
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose();
      }}
    >
      {/* Actions on the LEFT: the pane's own hover buttons sit top-right and covered "Close" */}
      <div className="flex h-7 shrink-0 items-center gap-1 border-b border-border bg-bg-secondary px-2">
        <button type="button" onClick={onClose} className={action} title="Close (Esc)">
          <X className="h-3 w-3" />
        </button>
        <span className="min-w-0 truncate text-[10px] text-text-secondary" title={path}>
          {path.split("/").pop()}
        </span>
        {dirty && (
          <>
            <span className="shrink-0 text-[9px] text-amber-400" title="Unsaved changes">
              ● modified
            </span>
            <button
              type="button"
              onClick={() => save()}
              disabled={writeFile.isPending}
              className="shrink-0 rounded bg-accent/20 px-1.5 py-0.5 text-[10px] text-accent hover:bg-accent/30 disabled:opacity-50"
              title="Save (Cmd+S)"
            >
              {writeFile.isPending ? "Saving..." : "Save"}
            </button>
          </>
        )}
        {saveError && <span className="min-w-0 truncate text-[9px] text-red-400">{saveError}</span>}
        <button
          type="button"
          onClick={() => openExternal(path)}
          className={action}
          title="Open with its default app"
        >
          <ExternalLink className="h-3 w-3" />
          Open
        </button>
        <button
          type="button"
          onClick={() => reveal(path)}
          className={action}
          title="Reveal in Finder"
        >
          <FolderSearch className="h-3 w-3" />
          Finder
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">{body}</div>
      <ConfirmDialog
        open={conflict}
        onOpenChange={setConflict}
        title="The file changed on disk"
        description={`${path.split("/").pop()} was modified since you started editing (an agent, or another editor). Overwrite it with your version?`}
        confirmLabel="Overwrite"
        variant="destructive"
        onConfirm={() => save(true)}
      />
    </div>
  );
}

function Message({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full flex-col items-center justify-center px-4 text-center text-xs text-text-muted">
      {children}
    </div>
  );
}
