import type { IDisposable, ILink, ILinkHandler, Terminal } from "@xterm/xterm";
import { trpcInvoke } from "../../lib/trpc-client";
import {
  type LinkSource,
  openTerminalFile,
  openTerminalUrl,
  sessionCwd,
} from "./terminal-link-actions";
import { LinkPathResolver } from "./terminal-link-resolver";
import {
  findFileMatches,
  findUrlMatches,
  type LinkMatch,
  linkClick,
  linkHint,
} from "./terminal-links";

/** One hint at a time, inside the terminal's element so it scrolls and unmounts with it */
function createTooltip(terminal: Terminal) {
  let el: HTMLDivElement | null = null;
  const hide = () => {
    el?.remove();
    el = null;
  };
  const show = (event: MouseEvent, text: string) => {
    const host = terminal.element;
    if (!host) return;
    hide();
    el = document.createElement("div");
    el.className =
      "pointer-events-none absolute z-20 max-w-[70%] whitespace-pre-wrap break-all rounded border border-border bg-bg-secondary px-2 py-1 text-[10px] leading-snug text-text-secondary shadow-lg";
    el.textContent = text;
    const rect = host.getBoundingClientRect();
    const x = Math.min(event.clientX - rect.left + 8, Math.max(0, rect.width - 240));
    const y = event.clientY - rect.top;
    el.style.left = `${x}px`;
    // Above the pointer, below it on the first rows
    if (y > 48) el.style.bottom = `${rect.height - y + 6}px`;
    else el.style.top = `${y + 18}px`;
    host.appendChild(el);
  };
  return { show, hide };
}

function rowText(terminal: Terminal, y: number): string | null {
  return terminal.buffer.active.getLine(y - 1)?.translateToString(true) ?? null;
}

/** Every path candidate on screen: what one resolve call asks about */
function viewportCandidates(terminal: Terminal): string[] {
  const buffer = terminal.buffer.active;
  const out: string[] = [];
  for (let row = buffer.viewportY; row < buffer.viewportY + terminal.rows; row++) {
    const text = buffer.getLine(row)?.translateToString(true);
    if (text) for (const m of findFileMatches(text)) out.push(m.text);
  }
  return out;
}

/**
 * URLs and file paths in a terminal open inside Exegol: URLs in the tab's preview pane, files
 * read-only over the terminal. Cmd+click: URL to the browser, file to the IDE; Cmd+Shift: Finder. Scheme'd,
 * bare and OSC 8 URLs all go through `openTerminalUrl`.
 */
export function registerTerminalLinkProviders(terminal: Terminal, source: LinkSource): IDisposable {
  const tooltip = createTooltip(terminal);
  const resolver = new LinkPathResolver((texts, cwd) =>
    trpcInvoke<Array<{ text: string; path: string | null }>>("terminalLinks.resolve", {
      agentId: source.agentId,
      cwd,
      texts,
    }),
  );

  const toLink = (
    match: LinkMatch,
    y: number,
    hint: string,
    activate: (event: MouseEvent) => void,
  ): ILink => ({
    range: { start: { x: match.index + 1, y }, end: { x: match.index + match.length, y } },
    text: match.text,
    activate,
    hover: (event) => tooltip.show(event, hint),
    leave: tooltip.hide,
  });

  const osc8: ILinkHandler = {
    activate: (event, uri) => openTerminalUrl(source, uri, linkClick(event)),
    hover: (event, uri) => tooltip.show(event, linkHint("url", uri)),
    leave: tooltip.hide,
    allowNonHttpProtocols: false,
  };
  terminal.options.linkHandler = osc8;

  const urls = terminal.registerLinkProvider({
    provideLinks(y, callback) {
      const text = rowText(terminal, y);
      const links = text
        ? findUrlMatches(text).map((m) => {
            const url = m.url ?? m.text;
            return toLink(m, y, linkHint("url", url), (event) =>
              openTerminalUrl(source, url, linkClick(event)),
            );
          })
        : [];
      callback(links.length ? links : undefined);
    },
  });

  const files = terminal.registerLinkProvider({
    provideLinks(y, callback) {
      const text = rowText(terminal, y);
      const matches = text ? findFileMatches(text) : [];
      if (!matches.length) return callback(undefined);
      resolver
        .resolve(
          matches.map((m) => m.text),
          sessionCwd(source.agentId),
          () => viewportCandidates(terminal),
        )
        .then((resolved) => {
          const links = matches
            .filter((m) => resolved.get(m.text))
            .map((m) => {
              const target = m.line ? `${m.text}:${m.line}${m.col ? `:${m.col}` : ""}` : m.text;
              return toLink(m, y, linkHint("file", m.text, target), (event) =>
                openTerminalFile(source, m, linkClick(event)),
              );
            });
          callback(links.length ? links : undefined);
        })
        .catch(() => callback(undefined));
    },
  });

  return {
    dispose: () => {
      tooltip.hide();
      urls.dispose();
      files.dispose();
    },
  };
}
