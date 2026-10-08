import { PREVIEW_PARTITION } from "@exegol/shared";
import { ExternalLink, PanelRight, X } from "lucide-react";
import { useState } from "react";
import { useLatest } from "../../hooks/use-latest";
import { useMountEffect } from "../../hooks/use-mount-effect";
import { useFilePreviewUrl } from "../../hooks/use-trpc";
import { openInBrowser } from "../../lib/open-in-browser";
import { openUrlBesideActivePane } from "../terminal/terminal-link-actions";

const tokenOf = (url: string) => url.split("/")[2] ?? "";

type PreviewLink = { url: string; host: string; dropped: boolean };

/**
 * An HTML file rendered from its project folder over exegol-preview://, in a webview on its own
 * in-memory session (main sets its preferences: no preload or Node, sandboxed, scripts only with
 * "Run scripts"; only the scheme loads). Not a browser pane: agents cannot drive it.
 */
export function HtmlPreview({
  path,
  runScripts,
  reloadKey,
}: {
  path: string;
  runScripts: boolean;
  /** Changes on Reload or when the file is saved: the page loads again */
  reloadKey: string;
}) {
  const { data, error } = useFilePreviewUrl(path, runScripts);
  const [link, setLink] = useState<PreviewLink | null>(null);
  const src = useLatest(data?.url);
  useMountEffect(() =>
    window.api.onPreviewLink(({ from, ...next }) => {
      if (!src.current || tokenOf(from) !== tokenOf(src.current)) return;
      setLink((shown) => (shown?.url === next.url ? shown : next));
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
    <div className="relative flex h-full flex-col">
      {/* Keyed by URL: main reads the scripts setting when the webview attaches */}
      <webview
        key={`${data.url}:${reloadKey}`}
        src={data.url}
        partition={PREVIEW_PARTITION}
        className="min-h-0 w-full flex-1 bg-white"
      />
      {link && <LinkBar link={link} onDismiss={() => setLink(null)} />}
    </div>
  );
}

const linkAction =
  "flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-text-secondary hover:bg-white/10 hover:text-text-primary";

/** The page asked to leave after a click: it only goes where the user sends it, from here */
function LinkBar({ link, onDismiss }: { link: PreviewLink; onDismiss: () => void }) {
  const open = (how: (url: string) => void) => {
    how(link.url);
    onDismiss();
  };
  return (
    <div className="flex shrink-0 items-center gap-1 border-t border-border bg-bg-secondary px-2 py-1">
      <span className="min-w-0 flex-1 truncate text-[10px] text-text-muted" title={link.url}>
        Link to <span className="text-text-primary">{link.host}</span>
        {link.dropped && <span className="ml-1 text-amber-400">(query and fragment removed)</span>}
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
