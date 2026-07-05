import { useEffect, useRef, useState } from "react";

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
  const seenRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!enabled) {
      // Agent stopped/pane changed: a stale "Open preview" chip would point
      // at a dev server that is likely dead.
      seenRef.current = new Set();
      setUrl(null);
      return;
    }
    seenRef.current = new Set();
    setUrl(null);

    return window.api.terminal.onData(agentId, (data) => {
      const matches = data.match(LOCALHOST_URL_RE);
      if (!matches) return;
      for (const raw of matches) {
        const clean = trimTrailingPunctuation(raw);
        if (seenRef.current.has(clean)) continue;
        seenRef.current.add(clean);
        setUrl(clean);
      }
    });
  }, [agentId, enabled]);

  return [url, () => setUrl(null)];
}
