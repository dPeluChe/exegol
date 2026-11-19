import { browserPartitionFor, VIEW_PAGE, type ViewLink, viewPath } from "@exegol/shared";
import { BrowserWindow, type NativeImage } from "electron";
import { captureFullPage } from "../browser/screenshot";
import { withTimeout } from "../lib/timeout";

const LOAD_TIMEOUT_MS = 20_000;
const QUIET_MS = 500;
const QUIET_CAP_MS = 6_000;

// Resolves once the page stopped changing and shows no loading placeholder: an app paints its
// frame first and its data later, and a capture or a link read before that sees skeletons.
// Only what is visible on the first screen counts, and text alone (a clock) is no change
const QUIET_SCRIPT = `new Promise((resolve) => {
  const BUSY = '[aria-busy="true"], [class*="skeleton" i], [class*="animate-pulse"], [class*="shimmer" i], [class*="spinner" i], [role="progressbar"]:not([aria-valuenow])';
  const busy = () => {
    for (const el of document.querySelectorAll(BUSY)) {
      const r = el.getBoundingClientRect();
      if (r.width < 24 || r.height < 4 || r.bottom <= 0 || r.top >= innerHeight) continue;
      if (el.checkVisibility({ opacityProperty: true, visibilityProperty: true })) return true;
    }
    return false;
  };
  const started = Date.now();
  let last = Date.now();
  const seen = new MutationObserver(() => { last = Date.now(); });
  seen.observe(document, { childList: true, subtree: true });
  const check = () => {
    const now = Date.now();
    const capped = now - started >= ${QUIET_CAP_MS};
    if (capped || (now - last >= ${QUIET_MS} && !busy())) {
      seen.disconnect();
      resolve(!capped);
    } else setTimeout(check, 100);
  };
  setTimeout(check, 100);
})`;

/** True when the page went quiet before the cap. A navigation under the wait (a guard sending
 *  the page elsewhere) ends the script's world: the wait starts once more on the new document */
async function settle(wc: Electron.WebContents): Promise<boolean> {
  for (let round = 0; round < 2; round++) {
    let moved = () => {};
    const navigated = new Promise<"moved">((resolve) => {
      moved = () => resolve("moved");
    });
    wc.once("did-navigate", moved);
    const result = await Promise.race([
      withTimeout(
        wc.executeJavaScriptInIsolatedWorld(LINKS_WORLD_ID, [{ code: QUIET_SCRIPT }]),
        QUIET_CAP_MS + 2_000,
        "page quiet",
      ).catch(() => false),
      navigated,
    ]);
    wc.off("did-navigate", moved);
    if (result !== "moved") return result === true;
  }
  return false;
}
const LINKS_WORLD_ID = 1339;
const RUN_DIALOG = "-run-dialog";

const LINKS_SCRIPT = `(() => {
  const links = [], external = new Set();
  let newTab = 0;
  for (const a of document.querySelectorAll("a[href]")) {
    let u;
    try { u = new URL(a.href, location.href); } catch { continue; }
    if (u.protocol !== "http:" && u.protocol !== "https:") continue;
    const blank = a.target === "_blank";
    if (blank) newTab++;
    if (u.origin === location.origin) links.push([u.pathname, blank]);
    else external.add(u.hostname);
  }
  return { links: links.slice(0, 500), external: [...external].slice(0, 40), newTab, height: document.documentElement.scrollHeight, login: !!document.querySelector("input[type=password]") };
})()`;

/** Content that appears as it scrolls into view would be blank in a capture taken at once:
 *  walk the part to capture first, with animations cut short, then go back to the top */
const SETTLE_CSS =
  "*,*::before,*::after{transition-duration:0s!important;transition-delay:0s!important;animation-duration:0s!important;animation-delay:0s!important;scroll-behavior:auto!important}";
const REVEAL_SCRIPT = `(async () => {
  const el = document.scrollingElement || document.documentElement;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const end = Math.min(el.scrollHeight - innerHeight, ${VIEW_PAGE.maxHeight});
  for (let y = innerHeight / 2; y < end + innerHeight / 2; y += innerHeight / 2) {
    el.scrollTop = Math.min(y, end);
    await wait(120);
  }
  el.scrollTop = 0;
  await wait(200);
})()`;

export interface PageRead {
  finalPath: string;
  http: number;
  /** False when the page was still loading or changing at the cap */
  quiet: boolean;
  image: NativeImage | null;
  cut: boolean;
  links: ViewLink[];
  externalHosts: string[];
  newTabLinks: number;
  /** The page has a password field */
  login: boolean;
}

/** A hidden window on the project's browser session: it loads pages, never shows and answers
 *  no dialog. It can only stay on `origin` */
export function captureWindow(projectId: string, origin: string): BrowserWindow {
  const win = new BrowserWindow({
    show: false,
    width: VIEW_PAGE.width,
    height: VIEW_PAGE.height,
    useContentSize: true,
    enableLargerThanScreen: true,
    webPreferences: {
      partition: browserPartitionFor(projectId),
      sandbox: true,
      backgroundThrottling: false,
    },
  });
  const wc = win.webContents;
  wc.setAudioMuted(true);
  wc.setWindowOpenHandler(() => ({ action: "deny" }));
  const stay = (event: Electron.Event, url: string) => {
    if (!url.startsWith(`${origin}/`) && url !== origin) event.preventDefault();
  };
  wc.on("will-navigate", stay);
  wc.on("will-redirect", stay);
  // Electron's private event: its default listener is an app-modal box that would block the pass
  const emitter = wc as unknown as NodeJS.EventEmitter;
  emitter.removeAllListeners(RUN_DIALOG);
  emitter.on(RUN_DIALOG, (_info: unknown, done: (ok: boolean, text: string) => void) =>
    done(false, ""),
  );
  return win;
}

async function capture(wc: Electron.WebContents): Promise<NativeImage | null> {
  await wc.insertCSS(SETTLE_CSS).catch(() => undefined);
  await withTimeout(
    wc.executeJavaScriptInIsolatedWorld(LINKS_WORLD_ID, [{ code: REVEAL_SCRIPT }]),
    5_000,
    "page reveal",
  ).catch(() => undefined);
  return captureFullPage(wc, { width: VIEW_PAGE.width, height: VIEW_PAGE.maxHeight }).catch(
    () => null,
  );
}

/** Load one page and read it: where it ended, its links and the top of it as an image. A page
 *  that ended elsewhere is not captured: the page it was sent to is a view of its own */
export async function readPage(win: BrowserWindow, url: string): Promise<PageRead> {
  const wc = win.webContents;
  let http = 0;
  const onNavigate = (_e: unknown, _url: string, code: number) => {
    http = code;
  };
  wc.on("did-navigate", onNavigate);
  try {
    // A redirect rejects the first load with ERR_ABORTED while the page it led to loads fine
    await withTimeout(wc.loadURL(url), LOAD_TIMEOUT_MS, "page load").catch(() => undefined);
    const quiet = await settle(wc);
    const finalPath = viewPath(new URL(wc.getURL()).pathname);
    const page = (await withTimeout(
      wc.executeJavaScriptInIsolatedWorld(LINKS_WORLD_ID, [{ code: LINKS_SCRIPT }]),
      5_000,
      "page links",
    )) as {
      links: [string, boolean][];
      external: string[];
      newTab: number;
      height: number;
      login: boolean;
    };
    const byPath = new Map<string, boolean>();
    for (const [to, blank] of page.links) {
      const path = viewPath(to);
      byPath.set(path, (byPath.get(path) ?? false) || blank);
    }
    const image = finalPath === viewPath(new URL(url).pathname) ? await capture(wc) : null;
    // Closed under the capture (a hold): no image is not this page's answer
    if (wc.isDestroyed()) throw new Error("window closed");
    return {
      finalPath,
      http,
      quiet,
      image: image && !image.isEmpty() ? image : null,
      cut: page.height > VIEW_PAGE.maxHeight,
      links: [...byPath].map(([to, newTab]) => ({ to, newTab })),
      externalHosts: page.external,
      newTabLinks: page.newTab,
      login: page.login,
    };
  } finally {
    wc.off("did-navigate", onNavigate);
  }
}
