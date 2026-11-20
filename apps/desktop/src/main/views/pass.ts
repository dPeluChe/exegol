import { rmSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  checkAgentUrl,
  holdFor,
  PREFERRED_PORTS_KEY,
  pickDevServerPort,
  robotsBlocks,
  VIEW_THUMB_WIDTH,
  VIEWS_MAX,
  type ViewEntry,
  type ViewSource,
  type ViewsState,
  viewCounts,
  viewIndex,
} from "@exegol/shared";
import { type BrowserWindow, clipboard, nativeImage } from "electron";
import type Database from "libsql";
import { opaque } from "../browser/page-image";
import { getProject } from "../db/queries/projects";
import { getJsonSetting } from "../db/queries/settings";
import { broadcast } from "../lib/event-bus";
import { logger } from "../lib/logger";
import { delay } from "../lib/timeout";
import { EXEGOL_DIR } from "../mcp/exegol-protocol";
import { captureWindow, type PageRead, readPage } from "./capture-window";
import { fileRoutes, siteMeta, viewServers } from "./discover";
import { seedSession } from "./session-seed";

const POOL = 3;
const JPEG_QUALITY = 72;
const FULL_QUALITY = 82;

interface Pass {
  state: ViewsState;
  /** Thumbnail file per view path */
  files: Map<string, string>;
  windows: BrowserWindow[];
  stopped: boolean;
  queue: ViewEntry[];
  /** Pages the person said to go on without (a login they will not do now) */
  skipped: Set<string>;
  waiting: (() => void)[];
  /** A view being captured again on its own: no pass starts over it */
  recapturing: boolean;
  /** Pages still loading at the cap: their captures may show placeholders */
  unsettled: number;
  /** When the current hold began, and the time spent on hold so far */
  heldAt: number | null;
  heldMs: number;
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

/** A pass that was cleared or replaced says nothing more: its push would undo what came after */
function push(projectId: string, pass: Pass, view?: ViewEntry): void {
  if (passes.get(projectId) !== pass) return;
  const run = pass.state.run;
  broadcast(
    "views:changed",
    view ? { projectId, run, view } : { projectId, run, state: pass.state },
  );
}

/** Workers of a held pass wait here until the person answers or the pass stops */
function held(pass: Pass): Promise<void> {
  return new Promise((resolve) => pass.waiting.push(resolve));
}

function wake(pass: Pass): void {
  for (const resolve of pass.waiting.splice(0)) resolve();
}

function closeWindows(pass: Pass): void {
  for (const win of pass.windows.splice(0)) if (!win.isDestroyed()) win.destroy();
}

export function stopViews(projectId: string): void {
  const pass = passes.get(projectId);
  if (!pass?.state.running) {
    // A view captured on its own has a window too
    if (pass) closeWindows(pass);
    return;
  }
  pass.stopped = true;
  closeWindows(pass);
  wake(pass);
}

/** Captures are disposable: gone with the pass's state, on a new pass and when the app quits */
export async function clearViews(projectId: string): Promise<void> {
  stopViews(projectId);
  passes.delete(projectId);
  await rm(dirOf(projectId), { recursive: true, force: true });
  broadcast("views:changed", { projectId, run: 0, state: empty() });
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
      view.login = undefined;
      pass.queue.push(view);
    }
  } else {
    pass.skipped.add(hold.path);
  }
  pass.state.hold = undefined;
  const waited = pass.heldAt ? Date.now() - pass.heldAt : 0;
  pass.heldMs += waited;
  pass.heldAt = null;
  logger.info(`[Views] ${projectId}: went on after ${waited}ms (${retry ? "retry" : "skip"})`);
  wake(pass);
  push(projectId, pass);
}

const fullOf = (thumb: string) => thumb.replace(/\.jpg$/, "-full.jpg");

/** The capture at the page's own size: what is copied, pasted to an agent or shown large */
export function viewFile(projectId: string, path: string): string | null {
  const thumb = passes.get(projectId)?.files.get(path);
  return thumb ? fullOf(thumb) : null;
}

/** The capture as a data URL: the thumbnail, or with `full` the page at its own size */
export async function viewThumb(
  projectId: string,
  path: string,
  full = false,
): Promise<string | null> {
  const thumb = passes.get(projectId)?.files.get(path);
  if (!thumb) return null;
  const file = full ? fullOf(thumb) : thumb;
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

/** What a page read says about its view, with its capture at full size and as a thumbnail */
async function record(
  pass: Pass,
  dir: string,
  view: ViewEntry,
  page: PageRead,
): Promise<ViewEntry["status"]> {
  view.status = page.finalPath === view.path ? "done" : "redirected";
  view.finalPath = view.status === "redirected" ? page.finalPath : undefined;
  view.login = view.status === "redirected" ? page.login : undefined;
  // A login page may answer 401: that view was sent to it, it did not fail
  if (page.http >= 400 && view.status === "done") view.status = "failed";
  view.http = page.http;
  view.links = page.links;
  view.externalHosts = page.externalHosts;
  view.newTabLinks = page.newTabLinks;
  view.cut = page.cut;
  if (!page.quiet) pass.unsettled++;
  const old = pass.files.get(view.path);
  if (old) {
    pass.files.delete(view.path);
    for (const gone of [old, fullOf(old)]) void rm(gone, { force: true });
  }
  if (!page.image) {
    // Sent elsewhere this time: the capture it had is no longer its page
    view.shot = undefined;
    view.width = undefined;
    view.height = undefined;
    return view.status;
  }
  const image = opaque(page.image);
  const thumb = image.resize({ width: VIEW_THUMB_WIDTH, quality: "best" });
  const size = thumb.getSize();
  const file = join(dir, `${++shot}.jpg`);
  await Promise.all([
    writeFile(file, thumb.toJPEG(JPEG_QUALITY), { mode: 0o600 }),
    writeFile(fullOf(file), image.toJPEG(FULL_QUALITY), { mode: 0o600 }),
  ]);
  pass.files.set(view.path, file);
  view.width = size.width;
  view.height = size.height;
  view.shot = shot;
  return view.status;
}

/** One view loaded and captured again, when no pass runs: the page may not have been ready,
 *  or changed since. Views it newly links to wait for the next pass */
export async function recaptureView(projectId: string, path: string): Promise<void> {
  const pass = passes.get(projectId);
  const view = pass?.state.views.find((v) => v.path === path);
  const base = pass?.state.base;
  if (!pass || !view || !base || pass.state.running || pass.recapturing) return;
  const before = view.status;
  pass.recapturing = true;
  view.status = "loading";
  push(projectId, pass, view);
  const win = captureWindow(projectId, base);
  pass.windows.push(win);
  try {
    await seedSession(win, projectId, base);
    const page = await readPage(win, base + view.path);
    if (passes.get(projectId) === pass) await record(pass, dirOf(projectId), view, page);
  } catch {
    view.status = before;
  } finally {
    pass.recapturing = false;
    closeWindows(pass);
  }
  if (passes.get(projectId) === pass) push(projectId, pass, view);
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
  const busy = last?.running || passes.get(projectId)?.recapturing;
  if (!project || busy || (opts.ifEmpty && last?.views.length)) return;
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
    waiting: [],
    recapturing: false,
    unsettled: 0,
    heldAt: null,
    heldMs: 0,
  };
  passes.set(projectId, pass);
  push(projectId, pass);

  const dir = dirOf(projectId);
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const server = servers.find((s) => s.port === port);
  const [meta, files] = await Promise.all([siteMeta(base), fileRoutes(server?.folder ?? null)]);
  const inSitemap = new Set(meta.sitemap ?? []);
  state.sitemap = meta.sitemap ? "found" : "missing";
  state.robots = meta.robots ? "found" : "missing";
  state.patterns = files.patterns;

  const index = viewIndex(VIEWS_MAX, (path) => ({
    inSitemap: inSitemap.has(path),
    robotsBlocked: meta.robots ? robotsBlocks(meta.robots, path) : false,
  }));
  const load = (view: ViewEntry): void => {
    state.views.push(view);
    queue.push(view);
  };
  /** The kept views a page's links added to: told once per page, not once per link */
  const add = (path: string, source: ViewSource, grown?: Set<ViewEntry>): void => {
    const found = index.add(path, source);
    if (found?.fresh) load(found.view);
    else if (found) grown?.add(found.view);
  };
  add("/", "links");
  for (const path of files.paths) add(path, "files");
  for (const path of inSitemap) add(path, "sitemap");
  push(projectId, pass);

  let loading = 0;
  const worker = async (): Promise<void> => {
    let win: BrowserWindow | null = null;
    while (!pass.stopped) {
      if (state.hold) {
        await held(pass);
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
        // Counted while it waits: with one view queued the other windows must not give up
        loading++;
        await seedSession(win, projectId, base);
        loading--;
        if (pass.stopped || win.isDestroyed()) {
          queue.unshift(view);
          continue;
        }
      }
      loading++;
      view.status = "loading";
      push(projectId, pass, view);
      try {
        const page = await readPage(win, base + view.path);
        if (pass.stopped) return;
        const status = await record(pass, dir, view, page);
        if (status === "done") {
          const grown = new Set<ViewEntry>();
          for (const link of page.links) add(link.to, "links", grown);
          for (const kept of grown) if (kept !== view) push(projectId, pass, kept);
        }
        if (status === "redirected") {
          add(page.finalPath, "links");
          const hold = holdFor(state.views, pass.skipped);
          if (hold && !state.hold) {
            // Waiting on the person: the windows go, so the wait costs nothing
            state.hold = hold;
            pass.heldAt = Date.now();
            logger.info(
              `[Views] ${projectId}: on hold (${state.views.some((v) => v.login && v.finalPath === hold.path) ? "a page asks for a password" : `${hold.views} views sent to one page`})`,
            );
            closeWindows(pass);
            push(projectId, pass);
          }
        }
      } catch {
        if (pass.stopped) return;
        // Its window went with a hold: the view waits with the rest
        view.status = state.hold ? "waiting" : "failed";
        if (state.hold) queue.unshift(view);
      } finally {
        // Before this window counts as free: the others quit on an empty queue
        const next = view.status === "failed" ? index.replace(view) : null;
        if (next) load(next);
        loading--;
      }
      push(projectId, pass, view);
    }
  };
  await Promise.all(Array.from({ length: POOL }, worker)).catch(() => undefined);
  closeWindows(pass);
  for (const view of state.views) if (view.status === "loading") view.status = "waiting";
  state.running = false;
  state.hold = undefined;
  push(projectId, pass);
  const counts = viewCounts(state.views);
  const onHold = pass.heldMs + (pass.heldAt ? Date.now() - pass.heldAt : 0);
  const alike = state.views.reduce((n, v) => n + (v.alike ?? 0), 0);
  logger.info(
    `[Views] pass ${projectId}: ${counts.total} views in ${Date.now() - started - onHold}ms (${counts.redirected} redirected, ${counts.failed} failed, ${pass.unsettled} not settled, ${alike} alike left out${onHold ? `, ${onHold}ms on hold` : ""}${pass.stopped ? ", stopped" : ""})`,
  );
}
