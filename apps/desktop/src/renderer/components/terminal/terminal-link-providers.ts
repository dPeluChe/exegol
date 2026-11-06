import type { IBufferRange, IDisposable, ILink, ILinkHandler, Terminal } from "@xterm/xterm";
import { IS_MAC } from "../../lib/keymap";
import { trpcInvoke } from "../../lib/trpc-client";
import { openTerminalFile, openTerminalUrl, sessionCwd } from "./terminal-link-actions";
import { LinkPathResolver, type ResolvedRow } from "./terminal-link-resolver";
import { dropCovered, inCell, type LinkRow, wrappedFileMatches } from "./terminal-link-wrap";
import {
  cellAt,
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

function rowAt(terminal: Terminal, y: number): LinkRow | null {
  const line = terminal.buffer.active.getLine(y - 1);
  return line ? { text: line.translateToString(true), wrapped: line.isWrapped } : null;
}

/** Paths on a row, those it shares with its neighbours included */
function pathMatches(terminal: Terminal, y: number): LinkMatch[] {
  const text = rowAt(terminal, y)?.text;
  return [
    ...wrappedFileMatches(y, (row) => rowAt(terminal, row), terminal.cols),
    ...(text ? findFileMatches(text) : []),
  ];
}

/** What the OSC 8 link shows on screen, which may not be where it goes */
function rangeText(terminal: Terminal, range: IBufferRange): string {
  let out = "";
  for (let y = range.start.y; y <= range.end.y; y++) {
    const line = terminal.buffer.active.getLine(y - 1);
    const start = y === range.start.y ? range.start.x - 1 : 0;
    const end = y === range.end.y ? range.end.x : undefined;
    out += line?.translateToString(true, start, end) ?? "";
  }
  return out.trim();
}

/** The punycode form of the target, flagged when the visible text names something else */
function osc8Label(terminal: Terminal, uri: string, range: IBufferRange): string {
  let href = uri;
  try {
    href = new URL(uri).href;
  } catch {}
  const shown = rangeText(terminal, range);
  const differs = shown !== uri && shown !== href;
  return differs ? `${href}\nThe link text differs from where it goes` : href;
}

/** Every path candidate on screen: what one resolve call asks about */
function viewportCandidates(terminal: Terminal): string[] {
  const { viewportY } = terminal.buffer.active;
  const out: string[] = [];
  for (let y = viewportY + 1; y <= viewportY + terminal.rows; y++) {
    for (const m of pathMatches(terminal, y)) out.push(m.text);
  }
  return out;
}

/**
 * URLs and file paths in a terminal open inside Exegol: URLs in the tab's preview pane, files
 * read-only in the floating file window. Cmd+click: URL to the browser, file to the IDE;
 * Cmd+Shift: Finder. Scheme'd, bare and OSC 8 URLs all go through `openTerminalUrl`.
 */
export function registerTerminalLinkProviders(terminal: Terminal, agentId: string): IDisposable {
  const tooltip = createTooltip(terminal);
  const resolver = new LinkPathResolver((texts, cwd) =>
    trpcInvoke<ResolvedRow[]>("terminalLinks.resolve", {
      agentId,
      cwd,
      texts,
    }),
  );

  /** The matches main confirmed, a wrapped path over its pieces */
  const confirmed = async (matches: LinkMatch[], y: number) => {
    const resolved = await resolver.resolve(
      matches.map((m) => m.text),
      sessionCwd(agentId),
      () => viewportCandidates(terminal),
    );
    return dropCovered(
      matches.filter((m) => resolved.get(m.text)),
      y,
    ).map((match) => {
      const kind = resolved.get(match.text)?.revealOnly ? ("reveal" as const) : ("file" as const);
      return { match, kind };
    });
  };

  const toLink = (
    match: LinkMatch,
    y: number,
    hint: string,
    activate: (event: MouseEvent) => void,
  ): ILink => ({
    range: match.range ?? {
      start: { x: match.index + 1, y },
      end: { x: match.index + match.length, y },
    },
    text: match.text,
    activate,
    hover: (event) => tooltip.show(event, hint),
    leave: tooltip.hide,
  });

  const osc8: ILinkHandler = {
    activate: (event, uri) => openTerminalUrl(agentId, uri, linkClick(event)),
    hover: (event, uri, range) =>
      tooltip.show(event, linkHint("url", uri, osc8Label(terminal, uri, range))),
    leave: tooltip.hide,
    allowNonHttpProtocols: false,
  };
  terminal.options.linkHandler = osc8;

  const urls = terminal.registerLinkProvider({
    provideLinks(y, callback) {
      const text = rowAt(terminal, y)?.text;
      const links = text
        ? findUrlMatches(text).map((m) => {
            const url = m.url ?? m.text;
            return toLink(m, y, linkHint("url", url), (event) =>
              openTerminalUrl(agentId, url, linkClick(event)),
            );
          })
        : [];
      callback(links.length ? links : undefined);
    },
  });

  const files = terminal.registerLinkProvider({
    provideLinks(y, callback) {
      const matches = pathMatches(terminal, y);
      if (!matches.length) return callback(undefined);
      confirmed(matches, y)
        .then((found) => {
          const links = found.map(({ match: m, kind }) => {
            const target = m.line ? `${m.text}:${m.line}${m.col ? `:${m.col}` : ""}` : m.text;
            return toLink(m, y, linkHint(kind, m.text, target), (event) =>
              openTerminalFile(agentId, m, linkClick(event), kind),
            );
          });
          callback(links.length ? links : undefined);
        })
        .catch(() => callback(undefined));
    },
  });

  // A TUI tracking the mouse (Claude) takes the press before xterm's links see a click, so a link
  // under the pointer is opened here first; Option (Shift off macOS) still selects
  let screen: Element | null = null;
  const onPress = (event: MouseEvent) => {
    if (event.button !== 0 || terminal.modes.mouseTrackingMode === "none") return;
    if (IS_MAC ? event.altKey : event.shiftKey) return;
    if (!screen?.isConnected) screen = terminal.element?.querySelector(".xterm-screen") ?? null;
    if (!screen) return;
    const cell = cellAt(
      screen.getBoundingClientRect(),
      terminal.cols,
      terminal.rows,
      terminal.buffer.active.viewportY,
      { x: event.clientX, y: event.clientY },
    );
    const text = cell && rowAt(terminal, cell.y)?.text;
    if (!cell || !text) return;
    const claim = () => {
      event.preventDefault();
      event.stopImmediatePropagation();
    };
    const url = findUrlMatches(text).find((m) => inCell(m, cell.col, cell.y));
    if (url) {
      claim();
      openTerminalUrl(agentId, url.url ?? url.text, linkClick(event));
      return;
    }
    const files = pathMatches(terminal, cell.y).filter((m) => inCell(m, cell.col, cell.y));
    if (!files.length) return;
    claim();
    const click = linkClick(event);
    void confirmed(files, cell.y)
      .then(([file]) => {
        if (file) openTerminalFile(agentId, file.match, click, file.kind);
      })
      .catch(() => {});
  };
  terminal.element?.addEventListener("mousedown", onPress, true);

  return {
    dispose: () => {
      tooltip.hide();
      terminal.element?.removeEventListener("mousedown", onPress, true);
      urls.dispose();
      files.dispose();
    },
  };
}
