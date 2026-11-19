import { rmSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  checkAgentUrl,
  robotsBlocks,
  skipsView,
  VIEWS_MAX,
  type ViewEntry,
  type ViewSource,
  type ViewsState,
} from "@exegol/shared";
import { app, type BrowserWindow, clipboard, nativeImage } from "electron";
import type Database from "libsql";
import { opaqueJpeg } from "../browser/page-image";
import { getProject } from "../db/queries/projects";
import { broadcast } from "../lib/event-bus";
import { logger } from "../lib/logger";
import { captureWindow, readPage } from "./capture-window";
import { fileRoutes, siteMeta, viewServers } from "./discover";

const POOL = 3;
const JPEG_QUALITY = 72;

interface Pass {
  state: ViewsState;
  /** Thumbnail file per view path */
  files: Map<string, string>;
  windows: BrowserWindow[];
  stopped: boolean;
}

const passes = new Map<string, Pass>();
const root = () => join(app.getPath("temp"), "exegol-views");
const dirOf = (projectId: string) => join(root(), projectId);

const EMPTY: ViewsState = {
  base: null,
  running: false,
  views: [],
  patterns: [],
  sitemap: "unread",
  robots: "unread",
  sitemapOnly: [],
};

export const viewsState = (projectId: string): ViewsState => passes.get(projectId)?.state ?? EMPTY;

const push = (projectId: string, patch: { view?: ViewEntry; state?: ViewsState }) =>
  broadcast("views:changed", { projectId, ...patch });

function closeWindows(pass: Pass): void {
  for (const win of pass.windows.splice(0)) if (!win.isDestroyed()) win.destroy();
}

export function stopViews(projectId: string): void {
  const pass = passes.get(projectId);
  if (!pass?.state.running) return;
  pass.stopped = true;
  closeWindows(pass);
}

/** Thumbnails are disposable: gone with the pass's state, on a new pass and when the app quits */
export async function clearViews(projectId: string): Promise<void> {
  stopViews(projectId);
  passes.delete(projectId);
  await rm(dirOf(projectId), { recursive: true, force: true });
  push(projectId, { state: EMPTY });
}

export function clearAllViews(): void {
  rmSync(root(), { recursive: true, force: true });
}

export const viewFile = (projectId: string, path: string): string | null =>
  passes.get(projectId)?.files.get(path) ?? null;

export async function viewThumb(projectId: string, path: string): Promise<string | null> {
  const file = viewFile(projectId, path);
  if (!file) return null;
  const data = await readFile(file).catch(() => null);
  return data ? `data:image/jpeg;base64,${data.toString("base64")}` : null;
}

export function copyViewImage(projectId: string, path: string): boolean {
  const file = viewFile(projectId, path);
  const image = file ? nativeImage.createFromPath(file) : null;
  if (!image || image.isEmpty()) return false;
  clipboard.writeImage(image);
  return true;
}

/** One pass over a local server of the project: routes from its page files, its sitemap and
 *  the links of each page loaded, each captured by a hidden window. Loads only, never a click */
export async function startViews(
  db: Database.Database,
  projectId: string,
  port: number,
  extra: readonly string[] = [],
): Promise<void> {
  const project = getProject(db, projectId);
  if (!project || passes.get(projectId)?.state.running) return;
  const checked = checkAgentUrl(`http://localhost:${port}`, project.browserHosts ?? []);
  if (!checked.ok) return;
  const base = new URL(checked.url).origin;
  const started = Date.now();
  const state: ViewsState = { ...EMPTY, base, running: true };
  const pass: Pass = { state, files: new Map(), windows: [], stopped: false };
  passes.set(projectId, pass);
  push(projectId, { state });

  const dir = dirOf(projectId);
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const server = (await viewServers(project.path)).find((s) => s.port === port);
  const [meta, files] = await Promise.all([siteMeta(base), fileRoutes(server?.folder ?? null)]);
  const inSitemap = new Set(meta.sitemap ?? []);
  state.sitemap = meta.sitemap ? "found" : "missing";
  state.robots = meta.robots ? "found" : "missing";
  state.patterns = files.patterns.map((pattern) => ({ pattern }));

  const byPath = new Map<string, ViewEntry>();
  const queue: ViewEntry[] = [];
  const add = (path: string, source: ViewSource): void => {
    const known = byPath.get(path);
    if (known) {
      if (!known.sources.includes(source)) known.sources.push(source);
      return;
    }
    if (byPath.size >= VIEWS_MAX || skipsView(path)) return;
    const view: ViewEntry = {
      path,
      sources: [source],
      status: "waiting",
      inSitemap: inSitemap.has(path),
      robotsBlocked: meta.robots ? robotsBlocks(meta.robots, path) : false,
    };
    byPath.set(path, view);
    state.views.push(view);
    queue.push(view);
  };
  add("/", "links");
  for (const path of files.paths) add(path, "files");
  for (const path of inSitemap) add(path, "sitemap");
  for (const path of extra) add(path, "added");
  push(projectId, { state });

  let shot = 0;
  const worker = async (): Promise<void> => {
    const win = captureWindow(projectId, base);
    pass.windows.push(win);
    while (!pass.stopped) {
      const view = queue.shift();
      if (!view) {
        // Another window may still be on a page whose links add work
        if (state.views.some((v) => v.status === "loading")) {
          await new Promise((r) => setTimeout(r, 150));
          continue;
        }
        return;
      }
      view.status = "loading";
      push(projectId, { view });
      try {
        const page = await readPage(win, base + view.path);
        if (pass.stopped) return;
        view.status = page.finalPath === view.path ? "done" : "redirected";
        if (view.status === "redirected") view.finalPath = page.finalPath;
        if (page.http >= 400) view.status = "failed";
        view.http = page.http;
        view.links = page.links;
        view.externalHosts = page.externalHosts;
        view.newTabLinks = page.newTabLinks;
        view.cut = page.cut;
        if (page.image) {
          const size = page.image.getSize();
          const file = join(dir, `${++shot}.jpg`);
          await writeFile(file, opaqueJpeg(page.image, JPEG_QUALITY), { mode: 0o600 });
          pass.files.set(view.path, file);
          view.width = size.width;
          view.height = size.height;
          view.shot = shot;
        }
        if (view.status === "done") for (const link of page.links) add(link.to, "links");
      } catch {
        if (pass.stopped) return;
        view.status = "failed";
      }
      push(projectId, { view });
    }
  };
  await Promise.all(Array.from({ length: POOL }, worker)).catch(() => undefined);
  closeWindows(pass);
  for (const view of state.views) if (view.status === "loading") view.status = "waiting";
  state.sitemapOnly = state.views
    .filter((v) => v.inSitemap && v.status === "failed")
    .map((v) => v.path);
  state.running = false;
  push(projectId, { state });
  const count = (s: ViewEntry["status"]) => state.views.filter((v) => v.status === s).length;
  logger.info(
    `[Views] pass ${projectId}: ${state.views.length} views in ${Date.now() - started}ms (${count("redirected")} redirected, ${count("failed")} failed${pass.stopped ? ", stopped" : ""})`,
  );
}
