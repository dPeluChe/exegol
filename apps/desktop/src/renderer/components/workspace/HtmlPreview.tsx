import { ExternalLink, PanelRight, X } from "lucide-react";
import { useState } from "react";
import { useLatest } from "../../hooks/use-latest";
import { useMountEffect } from "../../hooks/use-mount-effect";
import { useFilePreviewUrl } from "../../hooks/use-trpc";
import { openInBrowser } from "../../lib/open-in-browser";
import { openUrlBesideActivePane } from "../terminal/terminal-link-actions";

const tokenOf = (url: string) => url.split("/")[2] ?? "";

/**
 * An HTML file rendered from its project folder over exegol-preview:// (main serves it read-only,
 * offline, CSP + request guard). Opaque-origin sandbox: no app access, no popups, no navigation
 * away; scripts only when the pane allows them. Not a browser pane: agents cannot drive it.
 */
export function HtmlPreview({
  path,
  runScripts,
  reloadKey,
}: {
  path: string;
  runScripts: boolean;
  /** Changes on Reload or when the file is saved: the frame loads again */
  reloadKey: string;
}) {
  const { data, error } = useFilePreviewUrl(path, runScripts);
  const [link, setLink] = useState<string | null>(null);
  const src = useLatest(data?.url);
  useMountEffect(() =>
    window.api.onPreviewLink(({ url, from }) => {
      if (src.current && tokenOf(from) === tokenOf(src.current)) setLink(url);
    }),
  );

  if (error) {
    return (
      <div className="flex h-full items-center justify-center px-4 text-center text-xs text-text-muted">
        Cannot preview this file: {error instanceof Error ? error.message : String(error)}
      </div>
    );
  }
  if (!data) return null;
  return (
    <div className="relative h-full">
      <iframe
        key={reloadKey}
        src={data.url}
        title={`Preview of ${path.split("/").pop()}`}
        sandbox={runScripts ? "allow-scripts" : ""}
        referrerPolicy="no-referrer"
        className="h-full w-full border-0 bg-white"
      />
      {link && <LinkBar url={link} onDismiss={() => setLink(null)} />}
    </div>
  );
}

const linkAction =
  "flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-text-secondary hover:bg-white/10 hover:text-text-primary";

/** The page asked to leave: it only goes where the user sends it, from here */
function LinkBar({ url, onDismiss }: { url: string; onDismiss: () => void }) {
  const open = (how: (url: string) => void) => {
    how(url);
    onDismiss();
  };
  return (
    <div className="absolute inset-x-0 bottom-0 flex items-center gap-1 border-t border-border bg-bg-secondary px-2 py-1">
      <span className="min-w-0 flex-1 truncate text-[10px] text-text-muted" title={url}>
        Link: {url}
      </span>
      <button type="button" className={linkAction} onClick={() => open(openUrlBesideActivePane)}>
        <PanelRight className="h-3 w-3" />
        Browser pane
      </button>
      <button type="button" className={linkAction} onClick={() => open(openInBrowser)}>
        <ExternalLink className="h-3 w-3" />
        External
      </button>
      <button type="button" className={linkAction} onClick={onDismiss} aria-label="Dismiss link">
        <X className="h-3 w-3" />
      </button>
    </div>
  );
}
