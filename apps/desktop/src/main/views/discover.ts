import { readdir } from "node:fs/promises";
import { join } from "node:path";
import {
  dedupeDevPorts,
  parseRobots,
  parseSitemap,
  type RobotsRules,
  routesFromFiles,
  splitDevPorts,
  viewPath,
} from "@exegol/shared";
import { net } from "electron";
import { getProjectPorts } from "../system/ports";
import { SKIP_DIRS } from "../system/scripts";

const PAGE_ROOTS = [["app"], ["pages"], ["src", "app"], ["src", "pages"], ["src", "routes"]];
const MAX_FILES = 5_000;
const FETCH_TIMEOUT_MS = 3_000;
const MAX_SITEMAPS = 5;
const MAX_SITEMAP_BYTES = 2 * 1024 * 1024;

export interface ViewServer {
  port: number;
  /** Where the server runs: its page files are read from here */
  folder: string | null;
}

/** The project's running local servers that serve pages, each with its process's folder */
export async function viewServers(projectPath: string): Promise<ViewServer[]> {
  const running = (await getProjectPorts(projectPath)).flatMap((p) =>
    p.source === "runtime" ? [p] : [],
  );
  return splitDevPorts(dedupeDevPorts(running)).pages.map((p) => ({
    port: p.port,
    folder: p.cwd ?? null,
  }));
}

async function walk(dir: string, rel: string, out: string[]): Promise<void> {
  if (out.length >= MAX_FILES) return;
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (out.length >= MAX_FILES) return;
    if (entry.name.startsWith(".") || SKIP_DIRS.has(entry.name)) continue;
    const path = `${rel}/${entry.name}`;
    if (entry.isDirectory()) await walk(join(dir, entry.name), path, out);
    else if (entry.isFile()) out.push(path);
  }
}

/** Routes the app's page files name; nothing when the folder is unknown or holds none */
export async function fileRoutes(folder: string | null) {
  const files: string[] = [];
  if (folder) {
    for (const root of PAGE_ROOTS) await walk(join(folder, ...root), root.join("/"), files);
  }
  return routesFromFiles(files);
}

async function fetchText(url: string): Promise<string | null> {
  try {
    const res = await net.fetch(url, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      redirect: "follow",
    });
    if (!res.ok || !/text|xml/i.test(res.headers.get("content-type") ?? "")) return null;
    const text = await res.text();
    return text.length > MAX_SITEMAP_BYTES ? null : text;
  } catch {
    return null;
  }
}

const pathOf = (loc: string): string | null => {
  try {
    return new URL(loc, "http://x").pathname;
  } catch {
    return null;
  }
};

export interface SiteMeta {
  robots: RobotsRules | null;
  /** Page paths the sitemap lists, or null with no sitemap */
  sitemap: string[] | null;
}

/** robots.txt and the sitemaps of the local server. A sitemap names the production host, so
 *  only the path of each url is used, for the sitemap files and for the pages alike */
export async function siteMeta(base: string): Promise<SiteMeta> {
  const robotsText = await fetchText(`${base}/robots.txt`);
  const robots = robotsText === null ? null : parseRobots(robotsText);
  const queue = [...(robots?.sitemaps ?? []), "/sitemap.xml", "/sitemap-index.xml"]
    .map(pathOf)
    .filter((p): p is string => !!p);
  const read = new Set<string>();
  const pages = new Set<string>();
  let found = false;
  while (queue.length > 0 && read.size < MAX_SITEMAPS) {
    const path = queue.shift() as string;
    if (read.has(path)) continue;
    read.add(path);
    const xml = await fetchText(base + path);
    if (xml === null || !/<(urlset|sitemapindex)[\s>]/i.test(xml)) continue;
    found = true;
    const { index, locs } = parseSitemap(xml);
    for (const loc of locs) {
      const p = pathOf(loc);
      if (!p) continue;
      if (index) queue.push(p);
      else pages.add(viewPath(p));
    }
  }
  return { robots, sitemap: found ? [...pages] : null };
}
