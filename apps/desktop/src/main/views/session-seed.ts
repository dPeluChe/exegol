import { type BrowserWindow, webContents } from "electron";
import { originOf } from "../browser/clipboard-policy";
import { panesOfProject } from "../browser/pane-registry";
import { logger } from "../lib/logger";
import { delay, withTimeout } from "../lib/timeout";

const SEED_WORLD_ID = 1340;
const MAX_SEED_CHARS = 1_000_000;
const APP_SETTLE_MS = 600;
// The origin is read with the entries: getURL can already name a page still on its way
const READ = "JSON.stringify([location.origin, Object.entries(sessionStorage)])";
const write = (entries: [string, string][]) =>
  `for (const [k, v] of ${JSON.stringify(entries)}) { try { sessionStorage.setItem(k, v); } catch {} }`;

async function paneSession(projectId: string, origin: string): Promise<[string, string][] | null> {
  for (const pane of panesOfProject(projectId)) {
    const source = webContents.fromId(pane.wcId);
    if (!source || source.isDestroyed() || originOf(source.getURL()) !== origin) continue;
    try {
      const text = (await withTimeout(
        source.executeJavaScriptInIsolatedWorld(SEED_WORLD_ID, [{ code: READ }]),
        2_000,
        "session read",
      )) as string;
      if (text.length > MAX_SEED_CHARS) continue;
      const [from, entries] = JSON.parse(text) as [string, [string, string][]];
      if (from === origin && entries.length > 0) return entries;
    } catch {
      // A pane that does not answer is no source: try the next
    }
  }
  return null;
}

/** sessionStorage is per tab, and many apps keep their login there: a capture window starts with
 *  what the project's own browser pane on this origin holds, as a duplicated tab would. Values
 *  go from page to page only, never to a log */
export async function seedSession(
  win: BrowserWindow,
  projectId: string,
  origin: string,
): Promise<void> {
  const entries = await paneSession(projectId, origin);
  if (!entries || win.isDestroyed()) return;
  const wc = win.webContents;
  const run = (code: string) => wc.executeJavaScriptInIsolatedWorld(SEED_WORLD_ID, [{ code }]);
  try {
    // A plain file of the origin: its storage opens with none of the app's scripts running
    await withTimeout(wc.loadURL(`${origin}/robots.txt`), 5_000, "seed page").catch(
      () => undefined,
    );
    if ((await run("location.origin")) !== origin) return;
    // A dev server may answer any path with the app: let it finish clearing a session it
    // does not have before the copy lands
    if ((await run("document.contentType")) === "text/html") await delay(APP_SETTLE_MS);
    await run(write(entries));
    logger.info(`[Views] ${projectId}: session of an open pane copied (${entries.length} key(s))`);
  } catch {
    // An error page or a closed window: the pass goes on without the copy
  }
}
