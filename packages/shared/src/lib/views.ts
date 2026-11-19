export type ViewSource = "files" | "links" | "sitemap";

export interface ViewLink {
  /** Same-origin path the link goes to */
  to: string;
  newTab: boolean;
}

export type ViewStatus = "waiting" | "loading" | "done" | "redirected" | "failed";

export interface ViewEntry {
  path: string;
  sources: ViewSource[];
  status: ViewStatus;
  /** Where the load ended when it was not `path` (a login, a locale) */
  finalPath?: string;
  /** The page it ended on asks for a password */
  login?: boolean;
  /** The response's status, 0 when none came */
  http?: number;
  /** Thumbnail size in px, once captured */
  width?: number;
  height?: number;
  /** The page went on below what the thumbnail shows */
  cut?: boolean;
  links?: ViewLink[];
  /** Hosts of the links that leave the site, and how many of all links open a new tab */
  externalHosts?: string[];
  newTabLinks?: number;
  inSitemap: boolean;
  robotsBlocked: boolean;
  /** Bumped per capture, so a new thumbnail is fetched */
  shot?: number;
}

export interface ViewsState {
  base: string | null;
  /** Which pass this is: a view pushed by an earlier one is dropped */
  run: number;
  running: boolean;
  views: ViewEntry[];
  /** Route patterns from page files that need values (`/users/[id]`): listed, never loaded */
  patterns: string[];
  /** The pass waits: this many views ended on `path`, most likely a login */
  hold?: { path: string; views: number };
  sitemap: "found" | "missing" | "unread";
  robots: "found" | "missing" | "unread";
}

export const VIEWS_MAX = 200;
/** Views ending on one other page before a pass stops to ask */
export const HOLD_AFTER = 2;

/** The page a pass should stop for: one that asks for a password, or where `HOLD_AFTER` views
 *  or more were sent, unless the person already said to go on without it */
export function holdFor(
  views: readonly ViewEntry[],
  skipped: ReadonlySet<string>,
): { path: string; views: number } | null {
  const sent = new Map<string, number>();
  for (const v of views) {
    if (v.status !== "redirected" || !v.finalPath || skipped.has(v.finalPath)) continue;
    const n = (sent.get(v.finalPath) ?? 0) + 1;
    if (v.login || n >= HOLD_AFTER) return { path: v.finalPath, views: n };
    sent.set(v.finalPath, n);
  }
  return null;
}
/** The page as most desktops show it, and how far down a thumbnail goes */
export const VIEW_PAGE = { width: 1920, height: 1080, maxHeight: 1920 } as const;
export const VIEW_THUMB_WIDTH = 960;

const PAGE_FILE = /\.(tsx|jsx|ts|js|mdx|md|astro|svelte|vue)$/;

function cleanSegments(parts: string[]): { path: string; dynamic: boolean } | null {
  const out: string[] = [];
  let dynamic = false;
  for (const part of parts) {
    if (!part || /^\(.*\)$/.test(part)) continue;
    if (part.startsWith("_") || part.startsWith("@")) return null;
    if (/[[\]]/.test(part) || part.startsWith(":") || part.startsWith("$")) dynamic = true;
    out.push(part);
  }
  return { path: `/${out.join("/")}`, dynamic };
}

export type ViewFramework = "next" | "astro" | "nuxt" | "sveltekit";

/** The framework whose folders name routes, from a package.json's dependencies. Any other app
 *  (a Vite SPA with its own router) keeps components in `pages`, which are no routes */
export function frameworkOf(deps: Readonly<Record<string, unknown>>): ViewFramework | null {
  if ("next" in deps) return "next";
  if ("astro" in deps) return "astro";
  if ("nuxt" in deps) return "nuxt";
  if ("@sveltejs/kit" in deps) return "sveltekit";
  return null;
}

/** The folders, under the app or its `src`, whose files name routes */
export const ROUTE_ROOTS: Record<ViewFramework, readonly string[]> = {
  next: ["app", "pages"],
  astro: ["pages"],
  nuxt: ["pages"],
  sveltekit: ["routes"],
};

/** Routes named by the framework's page files (paths relative to the app's folder, `/`
 *  separators). Endpoints are left out; with no such framework there are none */
export function routesFromFiles(
  files: readonly string[],
  framework: ViewFramework | null,
): { paths: string[]; patterns: string[] } {
  const roots = framework ? ROUTE_ROOTS[framework] : [];
  const paths = new Set<string>();
  const patterns = new Set<string>();
  for (const raw of files) {
    const file = raw.replace(/^src\//, "");
    if (!PAGE_FILE.test(file)) continue;
    const parts = file.split("/");
    const root = parts.shift();
    if (!root || !roots.includes(root)) continue;
    const name = (parts.pop() ?? "").replace(PAGE_FILE, "");
    let segments: string[] | null = null;
    if (root === "app" && name === "page") segments = parts;
    else if (root === "routes" && name === "+page") segments = parts;
    else if (root === "pages" && parts[0] !== "api" && !/\.(xml|txt|json)$/.test(name)) {
      segments = name === "index" ? parts : [...parts, name];
    }
    if (!segments) continue;
    const route = cleanSegments(segments);
    if (!route) continue;
    (route.dynamic ? patterns : paths).add(route.path);
  }
  return { paths: [...paths].sort(), patterns: [...patterns].sort() };
}

/** A page path as views are keyed: no query, no hash, no trailing slash but the root's */
export function viewPath(pathname: string): string {
  const path = pathname.split(/[?#]/)[0] ?? "/";
  const trimmed = path.length > 1 ? path.replace(/\/+$/, "") : path;
  return trimmed.startsWith("/") ? trimmed || "/" : `/${trimmed}`;
}

/** A path a pass never loads: it may change something by being opened, or it is no page */
export function skipsView(path: string): boolean {
  return (
    /(^|\/)(log-?out|sign-?out|delete|remove|destroy|unsubscribe)(\/|$)/i.test(path) ||
    /^\/(api|_next|_astro|__)/.test(path) ||
    /\.[a-z0-9]{2,5}$/i.test(path)
  );
}

export interface RobotsRules {
  disallow: string[];
  allow: string[];
  sitemaps: string[];
}

/** The rules for every crawler (`User-agent: *`) and the sitemaps the file names */
export function parseRobots(text: string): RobotsRules {
  const rules: RobotsRules = { disallow: [], allow: [], sitemaps: [] };
  let applies = false;
  let inAgents = false;
  for (const line of text.split(/\r?\n/)) {
    const m = line.replace(/#.*$/, "").match(/^\s*([a-z-]+)\s*:\s*(.*?)\s*$/i);
    if (!m) continue;
    const key = (m[1] as string).toLowerCase();
    const value = m[2] as string;
    if (key === "user-agent") {
      applies = inAgents ? applies || value === "*" : value === "*";
      inAgents = true;
      continue;
    }
    inAgents = false;
    if (key === "sitemap" && value) rules.sitemaps.push(value);
    else if (applies && key === "disallow" && value) rules.disallow.push(value);
    else if (applies && key === "allow" && value) rules.allow.push(value);
  }
  return rules;
}

function robotsMatch(rule: string, path: string): boolean {
  const end = rule.endsWith("$");
  const body = (end ? rule.slice(0, -1) : rule)
    .split("*")
    .map((s) => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  return new RegExp(`^${body}${end ? "$" : ""}`).test(path);
}

/** The longest matching rule decides, and Allow wins a tie */
export function robotsBlocks(rules: RobotsRules, path: string): boolean {
  const longest = (list: string[]) =>
    Math.max(-1, ...list.filter((r) => robotsMatch(r, path)).map((r) => r.length));
  const blocked = longest(rules.disallow);
  return blocked >= 0 && blocked > longest(rules.allow);
}

/** `<loc>` urls of a sitemap or a sitemap index; `index` when they are more sitemaps */
export function parseSitemap(xml: string): { index: boolean; locs: string[] } {
  const locs = [...xml.matchAll(/<loc>\s*(?:<!\[CDATA\[)?\s*([^<\]\s]+)/gi)].map((m) =>
    (m[1] as string).replace(/&amp;/g, "&"),
  );
  return { index: /<sitemapindex[\s>]/i.test(xml), locs };
}

export interface ViewBox {
  path: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ViewsLayout {
  boxes: ViewBox[];
  /** Parent to child lines, as SVG path data */
  lines: { to: string; d: string }[];
  width: number;
  height: number;
}

export interface LayoutOptions {
  cardWidth: number;
  /** Card height for a view by path: its thumbnail plus the label */
  cardHeight: (path: string) => number;
  gapX: number;
  gapY: number;
  /** Children side by side before they wrap to another row */
  perRow: number;
}

/** The nearest listed ancestor by path segments: `/a/b/c` hangs from `/a/b`, else `/a`, else the
 *  root when it is listed */
export function parentView(path: string, all: ReadonlySet<string>): string | null {
  if (path === "/") return null;
  const parts = path.split("/").filter(Boolean);
  for (let i = parts.length - 1; i > 0; i--) {
    const up = `/${parts.slice(0, i).join("/")}`;
    if (all.has(up)) return up;
  }
  return all.has("/") ? "/" : null;
}

interface Block {
  path: string;
  width: number;
  height: number;
  place: (x: number, y: number) => void;
}

/** A tree by path: each view above its children, children in rows of `perRow` blocks, every
 *  block as wide as what hangs from it, so nothing overlaps whatever the card heights are */
export function layoutViews(paths: readonly string[], opts: LayoutOptions): ViewsLayout {
  const all = new Set(paths);
  const kids = new Map<string | null, string[]>();
  for (const path of [...all].sort()) {
    const parent = parentView(path, all);
    kids.set(parent, [...(kids.get(parent) ?? []), path]);
  }
  const boxes: ViewBox[] = [];
  const lines: ViewsLayout["lines"] = [];

  const rowsOf = (blocks: Block[]) => {
    const rows: Block[][] = [];
    for (let i = 0; i < blocks.length; i += opts.perRow)
      rows.push(blocks.slice(i, i + opts.perRow));
    return rows.map((row) => ({
      row,
      width: row.reduce((w, b) => w + b.width, 0) + opts.gapX * (row.length - 1),
      height: Math.max(...row.map((b) => b.height)),
    }));
  };

  const build = (path: string): Block => {
    const cardH = opts.cardHeight(path);
    const rows = rowsOf((kids.get(path) ?? []).map(build));
    const below = rows.reduce((h, r) => h + opts.gapY + r.height, 0);
    const width = Math.max(opts.cardWidth, ...rows.map((r) => r.width));
    return {
      path,
      width,
      height: cardH + below,
      place: (x, y) => {
        const cardX = x + (width - opts.cardWidth) / 2;
        boxes.push({ path, x: cardX, y, width: opts.cardWidth, height: cardH });
        const fromX = cardX + opts.cardWidth / 2;
        const fromY = y + cardH;
        let rowY = fromY + opts.gapY;
        for (const r of rows) {
          let childX = x + (width - r.width) / 2;
          const busY = rowY - opts.gapY / 2;
          for (const b of r.row) {
            const toX = childX + b.width / 2;
            lines.push({
              to: b.path,
              d: `M${fromX} ${fromY}V${busY}H${toX}V${rowY}`,
            });
            b.place(childX, rowY);
            childX += b.width + opts.gapX;
          }
          rowY += r.height + opts.gapY;
        }
      },
    };
  };

  const roots = rowsOf((kids.get(null) ?? []).map(build));
  let y = 0;
  let width = 0;
  for (const r of roots) {
    let x = 0;
    for (const b of r.row) {
      b.place(x, y);
      x += b.width + opts.gapX;
    }
    width = Math.max(width, r.width);
    y += r.height + opts.gapY * 2;
  }
  return { boxes, lines, width, height: Math.max(0, y - opts.gapY * 2) };
}

/** How many views a pass holds by outcome; `left` are the ones not loaded yet */
export function viewCounts(views: readonly ViewEntry[]) {
  const counts = { total: views.length, redirected: 0, failed: 0, left: 0 };
  for (const v of views) {
    if (v.status === "redirected") counts.redirected++;
    else if (v.status === "failed") counts.failed++;
    else if (v.status !== "done") counts.left++;
  }
  return counts;
}
