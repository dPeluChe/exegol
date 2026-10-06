import { editKeys, IS_MAC } from "../../lib/keymap";

/**
 * What a terminal row links to: http(s) URLs (scheme'd or bare `github.com/x`) and file paths
 * (absolute, `~/`, relative to the session cwd, with an optional `:line` or `:line:col`).
 * Paths only become links once main confirms the file exists (terminal-link-resolver).
 */

export interface LinkMatch {
  text: string;
  /** 0-based start index of `text` in the row string */
  index: number;
  /** underline length (may exceed text, e.g. the `:42:7` suffix) */
  length: number;
  line?: number;
  col?: number;
  /** URL matches: what opens (a bare domain gets https://) */
  url?: string;
}

const FILE_LINK_RE =
  /(?:^|[\s"'`(<[])((?:\.{1,2}\/|\/)?(?:[\w@~+-][\w.@~+-]*\/)+[\w.@~+-]+\.[A-Za-z][A-Za-z0-9]{0,7}|[\w@~+-][\w.@~+-]*\.[A-Za-z][A-Za-z0-9]{0,7})(?::(\d{1,6})(?::(\d{1,4}))?)?(?=$|[\s"'`)>\],:;!?]|\.(?:$|\s))/g;

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
  /(?:^|[\s"'`(<[])((?:[\w-]+\.)+([a-z]{2,6})(?::\d{2,5})?(?:\/[\w\-./?=&#%~+@]*)?)(?=$|[\s"'`)>\],;:!?]|\.(?:$|\s))/g;

/** Only http(s): file:, javascript: and data: never become URL links */
const SCHEME_URL_RE = /\bhttps?:\/\/[^\s"'`<>]+/gi;

/** Prose and markdown wrap URLs: a trailing `.` or `,` and an unbalanced `)` or `]` are not
 *  part of it */
export function trimUrl(url: string): string {
  let out = url;
  while (out.length) {
    const last = out[out.length - 1] as string;
    if (/[.,;:!?'"*]/.test(last)) {
      out = out.slice(0, -1);
      continue;
    }
    const open = last === ")" ? "(" : last === "]" ? "[" : null;
    if (open && out.split(open).length < out.split(last).length) {
      out = out.slice(0, -1);
      continue;
    }
    break;
  }
  return out;
}

export function findUrlMatches(rowText: string): LinkMatch[] {
  const out: LinkMatch[] = [];
  for (const m of rowText.matchAll(SCHEME_URL_RE)) {
    const text = trimUrl(m[0]);
    if (text.length > "https://".length) {
      out.push({ text, index: m.index ?? 0, length: text.length, url: text });
    }
  }
  for (const m of rowText.matchAll(BARE_URL_RE)) {
    const text = m[1];
    const tld = m[2];
    if (!text || !tld || !BARE_URL_TLDS.has(tld)) continue;
    const index = (m.index ?? 0) + m[0].indexOf(text);
    if (overlaps(out, index, text.length)) continue;
    out.push({ text, index, length: text.length, url: `https://${text}` });
  }
  return out.sort((a, b) => a.index - b.index);
}

export function findFileMatches(rowText: string): LinkMatch[] {
  const urls = findUrlMatches(rowText);
  const out: LinkMatch[] = [];
  for (const m of rowText.matchAll(FILE_LINK_RE)) {
    const path = m[1];
    if (!path) continue;
    const ext = path.slice(path.lastIndexOf(".") + 1).toLowerCase();
    // A dotted token without slashes whose "extension" is a TLD is a domain, not a file
    if (BARE_URL_TLDS.has(ext) && !path.includes("/")) continue;
    const index = (m.index ?? 0) + m[0].indexOf(path);
    const suffix = (m[2] ? m[2].length + 1 : 0) + (m[3] ? m[3].length + 1 : 0);
    if (overlaps(urls, index, path.length)) continue;
    out.push({
      text: path,
      index,
      length: path.length + suffix,
      line: m[2] ? Number(m[2]) : undefined,
      col: m[3] ? Number(m[3]) : undefined,
    });
  }
  return out;
}

function overlaps(matches: LinkMatch[], index: number, length: number): boolean {
  return matches.some((m) => index < m.index + m.length && m.index < index + length);
}

const IMAGE_EXT = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg"]);
/** Opened by the system app: the peek has nothing useful to show for these */
const SYSTEM_EXT = new Set([
  "pdf",
  "doc",
  "docx",
  "xls",
  "xlsx",
  "ppt",
  "pptx",
  "key",
  "numbers",
  "pages",
  "zip",
  "gz",
  "tgz",
  "tar",
  "dmg",
  "mp3",
  "wav",
  "mp4",
  "mov",
  "webm",
]);

const extOf = (path: string) => path.slice(path.lastIndexOf(".") + 1).toLowerCase();

export const isImagePath = (path: string) => IMAGE_EXT.has(extOf(path));

export type LinkAction = "pane" | "browser" | "peek" | "system" | "reveal";

/** Plain click keeps the user in Exegol; the click modifier hands off to the OS */
export function linkAction(kind: "url" | "file", modifier: boolean, path = ""): LinkAction {
  if (kind === "url") return modifier ? "browser" : "pane";
  if (modifier) return "reveal";
  return SYSTEM_EXT.has(extOf(path)) ? "system" : "peek";
}

const ACTION_LABEL: Record<LinkAction, (mac: boolean) => string> = {
  pane: () => "open in the preview pane",
  browser: () => "open in the system browser",
  peek: () => "open here",
  system: () => "open with the default app",
  reveal: (mac) => (mac ? "reveal in Finder" : "show in the file manager"),
};

/** The hover tooltip: the target, then what a click and a modifier click do */
export function linkHint(
  kind: "url" | "file",
  target: string,
  label = target,
  mac = IS_MAC,
): string {
  const click = ACTION_LABEL[linkAction(kind, false, target)](mac);
  const modified = ACTION_LABEL[linkAction(kind, true, target)](mac);
  return `${label}\nClick: ${click} · ${editKeys("Cmd+click", mac)}: ${modified}`;
}
