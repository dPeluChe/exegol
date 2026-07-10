import type { IDisposable, ILink, Terminal } from "@xterm/xterm";

/**
 * T155: link providers for terminal panes (klaudio-panels pattern).
 *
 * - File paths (`src/foo.ts`, `./a/b.rs:42`): Cmd+click opens in the IDE at
 *   the line. Cmd is required — file-ish tokens are everywhere in agent
 *   output and plain click must keep meaning "select text".
 * - Bare URLs (`github.com/x/y`, no scheme): plain click opens the default
 *   external browser (same as the scheme'd URLs WebLinksAddon already
 *   handles); Cmd+click opens an in-app browser pane.
 */

const FILE_LINK_RE =
  /(?:^|[\s"'`(<[])((?:\.{1,2}\/|\/)?(?:[\w@~+-][\w.@~+-]*\/)+[\w.@~+-]+\.[A-Za-z][A-Za-z0-9]{0,7}|[\w@~+-][\w.@~+-]*\.[A-Za-z][A-Za-z0-9]{0,7})(?::(\d{1,6}))?(?=$|[\s"'`)>\],:;])/g;

/** Small allowlist so `foo.ts` / `config.json` never read as domains. */
const BARE_URL_TLDS = new Set([
  "com",
  "org",
  "net",
  "io",
  "dev",
  "ai",
  "app",
  "sh",
  "co",
  "me",
  "gg",
  "xyz",
]);

const BARE_URL_RE =
  /(?:^|[\s"'`(<[])((?:[\w-]+\.)+([a-z]{2,6})(?::\d{2,5})?(?:\/[\w\-./?=&#%~+@]*)?)(?=$|[\s"'`)>\],;])/g;

interface LinkMatch {
  text: string;
  /** 0-based start index of `text` in the row string */
  index: number;
  /** underline length (may exceed text, e.g. the `:42` suffix) */
  length: number;
  line?: number;
}

export function findFileMatches(rowText: string): LinkMatch[] {
  const out: LinkMatch[] = [];
  FILE_LINK_RE.lastIndex = 0;
  let m = FILE_LINK_RE.exec(rowText);
  while (m !== null) {
    const path = m[1];
    if (path) {
      const ext = path.slice(path.lastIndexOf(".") + 1).toLowerCase();
      // A dotted token without slashes whose "extension" is a TLD is a domain,
      // not a file — leave it to the URL provider.
      if (!(BARE_URL_TLDS.has(ext) && !path.includes("/"))) {
        const index = m.index + m[0].indexOf(path);
        const suffix = m[2] ? m[2].length + 1 : 0;
        out.push({
          text: path,
          index,
          length: path.length + suffix,
          line: m[2] ? Number(m[2]) : undefined,
        });
      }
    }
    m = FILE_LINK_RE.exec(rowText);
  }
  return out;
}

export function findBareUrlMatches(rowText: string): LinkMatch[] {
  const out: LinkMatch[] = [];
  BARE_URL_RE.lastIndex = 0;
  let m = BARE_URL_RE.exec(rowText);
  while (m !== null) {
    const url = m[1];
    const tld = m[2];
    if (url && tld && BARE_URL_TLDS.has(tld)) {
      out.push({ text: url, index: m.index + m[0].indexOf(url), length: url.length });
    }
    m = BARE_URL_RE.exec(rowText);
  }
  return out;
}

function toLink(
  match: LinkMatch,
  y: number,
  activate: (event: MouseEvent, text: string) => void,
): ILink {
  return {
    range: {
      start: { x: match.index + 1, y },
      end: { x: match.index + match.length, y },
    },
    text: match.text,
    activate,
  };
}

export interface TerminalLinkHandlers {
  onOpenFile?: (path: string, line?: number) => void;
  onOpenUrlInPane?: (url: string) => void;
}

export function registerTerminalLinkProviders(
  terminal: Terminal,
  handlers: TerminalLinkHandlers,
): IDisposable {
  const disposables: IDisposable[] = [];

  if (handlers.onOpenFile) {
    const onOpenFile = handlers.onOpenFile;
    disposables.push(
      terminal.registerLinkProvider({
        provideLinks(y, callback) {
          const row = terminal.buffer.active.getLine(y - 1);
          if (!row) return callback(undefined);
          const text = row.translateToString(true);
          const links = findFileMatches(text).map((match) =>
            toLink(match, y, (event) => {
              if (event.metaKey || event.ctrlKey) onOpenFile(match.text, match.line);
            }),
          );
          callback(links.length ? links : undefined);
        },
      }),
    );
  }

  disposables.push(
    terminal.registerLinkProvider({
      provideLinks(y, callback) {
        const row = terminal.buffer.active.getLine(y - 1);
        if (!row) return callback(undefined);
        const text = row.translateToString(true);
        const links = findBareUrlMatches(text).map((match) =>
          toLink(match, y, (event) => {
            const url = `https://${match.text}`;
            if ((event.metaKey || event.ctrlKey) && handlers.onOpenUrlInPane) {
              handlers.onOpenUrlInPane(url);
            } else {
              // main's window-open handler routes this to the default browser
              window.open(url, "_blank", "noopener");
            }
          }),
        );
        callback(links.length ? links : undefined);
      },
    }),
  );

  return {
    dispose: () => {
      for (const d of disposables) d.dispose();
    },
  };
}
