import { type BrowserWindow, webContents } from "electron";
import { panesOfProject } from "../browser/pane-registry";
import { logger } from "../lib/logger";
import { delay, withTimeout } from "../lib/timeout";

const SEED_WORLD_ID = 1340;
const MAX_SEED_CHARS = 1_000_000;
const APP_SETTLE_MS = 600;
const READ = "JSON.stringify(Object.entries(sessionStorage))";
const write = (entries: string) =>
  `for (const [k, v] of ${entries}) { try { sessionStorage.setItem(k, v); } catch {} }`;

function originOf(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

/** sessionStorage is per tab, and many apps keep their login there: a capture window starts with
 *  what the project's own browser pane on this origin holds, as a duplicated tab would. Values
 *  go from page to page only, never to a log */
export async function seedSession(
  win: BrowserWindow,
  projectId: string,
  origin: string,
): Promise<void> {
  for (const pane of panesOfProject(projectId)) {
    const source = webContents.fromId(pane.wcId);
    if (!source || source.isDestroyed() || originOf(source.getURL()) !== origin) continue;
    try {
      const entries = (await withTimeout(
        source.executeJavaScriptInIsolatedWorld(SEED_WORLD_ID, [{ code: READ }]),
        2_000,
        "session read",
      )) as string;
      const count = (JSON.parse(entries) as unknown[]).length;
      if (count === 0 || entries.length > MAX_SEED_CHARS) continue;
      // A plain file of the origin: its storage opens with none of the app's scripts running
      await withTimeout(win.webContents.loadURL(`${origin}/robots.txt`), 5_000, "seed page").catch(
        () => undefined,
      );
      if (originOf(win.webContents.getURL()) !== origin) return;
      const run = (code: string) =>
        win.webContents.executeJavaScriptInIsolatedWorld(SEED_WORLD_ID, [{ code }]);
      // A dev server may answer any path with the app: let it finish clearing a session it
      // does not have before the copy lands
      if ((await run("document.contentType")) === "text/html") await delay(APP_SETTLE_MS);
      await run(write(entries));
      logger.info(`[Views] ${projectId}: session of an open pane copied (${count} key(s))`);
      return;
    } catch {
      // A pane that does not answer is no source: try the next
    }
  }
}
