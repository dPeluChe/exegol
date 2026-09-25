import { ExternalLink, FolderSearch, X } from "lucide-react";
import { lazy, Suspense, useEffect, useMemo } from "react";
import type { FileContent } from "../../hooks/use-trpc";
import { trpcMutate } from "../../lib/trpc-client";

const CodeViewer = lazy(() => import("./CodeViewer").then((m) => ({ default: m.CodeViewer })));

const openExternal = (path: string) => trpcMutate("files.openExternal", { path }).catch(() => {});
const reveal = (path: string) => trpcMutate("files.reveal", { path }).catch(() => {});

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/** PDF bytes as a blob URL (a data: URL is refused for PDFs in frames) */
function usePdfUrl(file: FileContent | undefined): string | null {
  const url = useMemo(() => {
    if (file?.kind !== "pdf" || !file.base64) return null;
    const bytes = Uint8Array.from(atob(file.base64), (c) => c.charCodeAt(0));
    return URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
  }, [file]);
  useEffect(
    () => () => {
      if (url) URL.revokeObjectURL(url);
    },
    [url],
  );
  return url;
}

/**
 * The file viewer next to the tree. Images and PDFs render as themselves (they
 * used to open as mojibake in Monaco); other binaries and very large files
 * offer the default app and Finder. Text stays read-only.
 */
export function FilePreview({
  path,
  file,
  error,
  onClose,
}: {
  path: string;
  file: FileContent | undefined;
  error: unknown;
  onClose: () => void;
}) {
  const pdfUrl = usePdfUrl(file);

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
        <CodeViewer key={path} content={file.content} fileName={path} />
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
        {file?.kind === "text" && (
          <span className="shrink-0 text-[9px] text-text-muted/70">read-only</span>
        )}
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
