import { rmSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  checkAgentUrl,
  holdFor,
  PREFERRED_PORTS_KEY,
  pickDevServerPort,
  robotsBlocks,
  skipsView,
  VIEWS_MAX,
  type ViewEntry,
  type ViewSource,
  type ViewsState,
  viewCounts,
} from "@exegol/shared";
import { type BrowserWindow, clipboard, nativeImage } from "electron";
import type Database from "libsql";
import { opaqueJpeg } from "../browser/page-image";
import { getProject } from "../db/queries/projects";
import { getJsonSetting } from "../db/queries/settings";
import { broadcast } from "../lib/event-bus";
import { logger } from "../lib/logger";
import { delay } from "../lib/timeout";
import { EXEGOL_DIR } from "../mcp/exegol-protocol";
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
  queue: ViewEntry[];
  /** Pages the person said to go on without (a login they will not do now) */
  skipped: Set<string>;
}

const passes = new Map<string, Pass>();
const root = () => join(EXEGOL_DIR, "views");
/** Never reused: a capture's number is what tells the renderer its thumbnail is new */
let shot = 0;
let runs = 0;
const dirOf = (projectId: string) => join(root(), projectId);

// A function: a pass fills its own lists, and a shared one doubled the views of the next pass
const empty = (): ViewsState => ({
  base: null,
  run: 0,
  running: false,
  views: [],
  patterns: [],
  sitemap: "unread",
  robots: "unread",
});

export const viewsState = (projectId: string): ViewsState =>
  passes.get(projectId)?.state ?? empty();

const push = (projectId: string, patch: { view?: ViewEntry; state?: ViewsState }) =>
  broadcast("views:changed", { projectId, run: viewsState(projectId).run, ...patch });

function closeWindows(pass: Pass): void {
  for (const win of pass.windows.splice(0)) if (!win.isDestroyed()) win.destroy();
}

export function stopViews(projectId: string): void {
  const pass = passes.get(projectId);
  if (!pass?.state.running) return;
  pass.stopped = true;
  closeWindows(pass);
}

/** Captures are disposable: gone with the pass's state, on a new pass and when the app quits */
export async function clearViews(projectId: string): Promise<void> {
  stopViews(projectId);
  passes.delete(projectId);
  await rm(dirOf(projectId), { recursive: true, force: true });
  push(projectId, { state: empty() });
}

export function clearAllViews(): void {
  rmSync(root(), { recursive: true, force: true });
}

/** The person answered a hold: `retry` loads again the views that were sent to that page (they
 *  logged in), else the pass goes on and never stops for that page again */
export function resumeViews(projectId: string, retry: boolean): void {
  const pass = passes.get(projectId);
  const hold = pass?.state.hold;
  if (!pass || !hold) return;
  if (retry) {
    for (const view of pass.state.views) {
      if (view.status !== "redirected" || view.finalPath !== hold.path) continue;
      view.status = "waiting";
      view.finalPath = undefined;
      pass.queue.push(view);
    }
  } else {
    pass.skipped.add(hold.path);
  }
  pass.state.hold = undefined;
  push(projectId, { state: pass.state });
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
  opts: { port?: number; ifEmpty?: boolean },
): Promise<void> {
  const project = getProject(db, projectId);
  const last = passes.get(projectId)?.state;
  if (!project || last?.running || (opts.ifEmpty && last?.views.length)) return;
  const servers = await viewServers(project.path);
  const preferred = getJsonSetting<Record<string, number>>(db, PREFERRED_PORTS_KEY, {})[projectId];
  const port =
    opts.port ??
    pickDevServerPort(servers, servers.some((s) => s.port === preferred) ? preferred : null);
  if (!port || passes.get(projectId)?.state.running) return;
  const checked = checkAgentUrl(`http://localhost:${port}`, project.browserHosts ?? []);
  if (!checked.ok) return;
  const base = new URL(checked.url).origin;
  const started = Date.now();
  const state: ViewsState = { ...empty(), base, run: ++runs, running: true };
  const queue: ViewEntry[] = [];
  const pass: Pass = {
    state,
    files: new Map(),
    windows: [],
    stopped: false,
    queue,
    skipped: new Set(),
  };
  passes.set(projectId, pass);
  push(projectId, { state });

  const dir = dirOf(projectId);
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const server = servers.find((s) => s.port === port);
  const [meta, files] = await Promise.all([siteMeta(base), fileRoutes(server?.folder ?? null)]);
  const inSitemap = new Set(meta.sitemap ?? []);
  state.sitemap = meta.sitemap ? "found" : "missing";
  state.robots = meta.robots ? "found" : "missing";
  state.patterns = files.patterns;

  const byPath = new Map<string, ViewEntry>();
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
  push(projectId, { state });

  let loading = 0;
  const worker = async (): Promise<void> => {
    let win: BrowserWindow | null = null;
    while (!pass.stopped) {
      if (state.hold) {
        await delay(300);
        continue;
      }
      const view = queue.shift();
      if (!view) {
        // Another window may still be on a page whose links add work
        if (loading === 0) return;
        await delay(150);
        continue;
      }
      if (!win || win.isDestroyed()) {
        win = captureWindow(projectId, base);
        pass.windows.push(win);
      }
      loading++;
      view.status = "loading";
      push(projectId, { view });
      try {
        // A view sent elsewhere is not captured: the page it was sent to is a view of its own
        const page = await readPage(win, base + view.path, (final) => final === view.path);
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
        if (view.status === "redirected") {
          add(page.finalPath, "links");
          const hold = holdFor(state.views, pass.skipped);
          if (hold && !state.hold) {
            // Waiting on the person: the windows go, so the wait costs nothing
            state.hold = hold;
            closeWindows(pass);
            push(projectId, { state });
          }
        }
      } catch {
        if (pass.stopped) return;
        // Its window went with a hold: the view waits with the rest
        view.status = state.hold ? "waiting" : "failed";
        if (state.hold) queue.unshift(view);
      } finally {
        loading--;
      }
      push(projectId, { view });
    }
  };
  await Promise.all(Array.from({ length: POOL }, worker)).catch(() => undefined);
  closeWindows(pass);
  for (const view of state.views) if (view.status === "loading") view.status = "waiting";
  state.running = false;
  state.hold = undefined;
  push(projectId, { state });
  const counts = viewCounts(state.views);
  logger.info(
    `[Views] pass ${projectId}: ${counts.total} views in ${Date.now() - started}ms (${counts.redirected} redirected, ${counts.failed} failed${pass.stopped ? ", stopped" : ""})`,
  );
}
