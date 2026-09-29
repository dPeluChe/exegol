import { useEffect, useState } from "react";

/** `http(s)://localhost[:port]` or `http(s)://127.0.0.1[:port]`, optional path. */
const LOCALHOST_URL_RE = /\bhttps?:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?(?:\/[^\s]*)?/gi;

/** Strip trailing punctuation a URL regex commonly over-captures from prose/ANSI framing. */
function trimTrailingPunctuation(url: string): string {
  return url.replace(/[.,;:!?)\]]+$/, "");
}

/**
 * T128: watches an agent's live PTY output for `localhost`/`127.0.0.1` URLs
 * (e.g. dev server startup banners) and surfaces the latest one so a toolbar
 * chip can offer to open it in a browser pane.
 *
 * Only sees live data — `window.api.terminal.onData` fires for new PTY bytes,
 * never for the scrollback snapshot written directly via `terminal.write()` —
 * so replayed history never re-triggers the chip.
 */
export function useTerminalUrlDetector(
  agentId: string,
  enabled: boolean,
): [url: string | null, dismiss: () => void] {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) return;
    const seen = new Set<string>();
    const unsubscribe = window.api.terminal.onData(agentId, (data) => {
      const matches = data.match(LOCALHOST_URL_RE);
      if (!matches) return;
      for (const raw of matches) {
        const clean = trimTrailingPunctuation(raw);
        if (seen.has(clean)) continue;
        seen.add(clean);
        setUrl(clean);
      }
    });
    // Agent stopped or pane changed: a stale "Open preview" chip would point
    // at a dev server that is likely dead
    return () => {
      unsubscribe();
      setUrl(null);
    };
  }, [agentId, enabled]);

  return [url, () => setUrl(null)];
}
