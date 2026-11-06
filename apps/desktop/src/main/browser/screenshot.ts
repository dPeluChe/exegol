import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { hostOf, screenshotFileName } from "@exegol/shared";
import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  type NativeImage,
  nativeImage,
  type WebContents,
} from "electron";
import { logger } from "../lib/logger";
import { withTimeout } from "../lib/timeout";
import { type TilePlan, tileCrop, tileStops } from "./full-page-tiles";
import { opaqueJpeg } from "./page-image";

export type ScreenshotTarget = "file" | "clipboard";
export type ScreenshotResult = "saved" | "copied" | "canceled" | "failed";

/** Image rows: past this the bitmap gets too big to hold and encode */
const FULL_PAGE_MAX_HEIGHT = 16_384;
/** Own world: the page cannot see or change the capture's state */
const SHOT_WORLD_ID = 1338;
/** A hidden or throttled webview may never run the frame callbacks a scroll waits on */
const SCRIPT_TIMEOUT_MS = 5_000;

/** One pass over the page: what scrolls (the document, or the tallest inner scroller of an app
 *  shell) and its fixed and sticky bars; hides the scrollbars and remembers what to restore */
const PLAN_SCRIPT = `(() => {
  const vh = innerHeight;
  const doc = document.scrollingElement || document.documentElement;
  let el = null, best = doc.scrollHeight - doc.clientHeight;
  const bars = [];
  for (const c of document.querySelectorAll("body *")) {
    const st = getComputedStyle(c);
    if (st.position === "fixed" || st.position === "sticky") bars.push([c, c.style.visibility]);
    if (c.clientHeight < vh * 0.5 || !/(auto|scroll)/.test(st.overflowY)) continue;
    const more = c.scrollHeight - c.clientHeight;
    if (more > best) { best = more; el = c; }
  }
  const s = el || doc;
  const style = document.createElement("style");
  style.textContent = "*::-webkit-scrollbar{display:none!important}*{scrollbar-width:none!important}";
  document.documentElement.appendChild(style);
  window.__exegolShot = { s, top: s.scrollTop, style, bars };
  return { total: s.scrollHeight, view: s.clientHeight, offset: el ? Math.max(0, el.getBoundingClientRect().top) : 0, vh };
})()`;

/** After the first strip, fixed and sticky bars would repeat in every strip */
const HIDE_BARS_SCRIPT = `(() => { for (const [e] of window.__exegolShot.bars) e.style.visibility = "hidden"; })()`;

const scrollScript = (y: number) => `new Promise((done) => {
  const x = window.__exegolShot;
  x.s.scrollTop = ${y};
  requestAnimationFrame(() => requestAnimationFrame(() => done(x.s.scrollTop)));
})`;

const RESTORE_SCRIPT = `(() => {
  const x = window.__exegolShot;
  for (const [e, v] of x.bars) e.style.visibility = v;
  x.style.remove();
  x.s.scrollTop = x.top;
  delete window.__exegolShot;
})()`;

/** The whole page, scrolled strip by strip and stitched: a webview's surface is the size of its
 *  element, so CDP's captureBeyondViewport repeated the visible area (seen at a 390x844 frame).
 *  The page sees the scroll and the hidden bars while it runs */
async function captureFullPage(wc: WebContents): Promise<NativeImage> {
  const run = <T>(code: string) =>
    withTimeout(
      wc.executeJavaScriptInIsolatedWorld(SHOT_WORLD_ID, [{ code }], true) as Promise<T>,
      SCRIPT_TIMEOUT_MS,
      "screenshot page script",
    );
  const plan = await run<TilePlan & { vh: number }>(PLAN_SCRIPT);
  try {
    const strips: Buffer[] = [];
    let width = 0;
    let scale = 1;
    let total = plan.total;
    for (const stop of tileStops(plan.total, plan.view)) {
      if (stop >= total) break;
      const real = await run<number>(scrollScript(stop));
      const image = await wc.capturePage();
      const size = image.getSize();
      if (stop === 0) {
        width = size.width;
        scale = size.height / plan.vh;
        total = Math.min(plan.total, Math.floor(FULL_PAGE_MAX_HEIGHT / scale));
        await run(HIDE_BARS_SCRIPT);
      }
      const crop = tileCrop(stop, real, { ...plan, total }, scale, size.height);
      if (!crop) break;
      strips.push(image.crop({ x: 0, y: crop.y, width, height: crop.height }).toBitmap());
    }
    const bitmap = Buffer.concat(strips);
    return nativeImage.createFromBitmap(bitmap, { width, height: bitmap.length / (width * 4) });
  } finally {
    await run(RESTORE_SCRIPT).catch(() => undefined);
  }
}

/** The pane's page as an image, to a file the user picks (PNG or JPEG by extension) or the
 *  clipboard. Logs the host only: a URL's path or query can carry tokens */
export async function savePaneScreenshot(
  wc: WebContents,
  sender: WebContents,
  opts: { target: ScreenshotTarget; fullPage: boolean },
): Promise<ScreenshotResult> {
  const url = wc.getURL();
  const host = hostOf(url) ?? "page";
  let image: NativeImage;
  try {
    image = opts.fullPage ? await captureFullPage(wc) : await wc.capturePage();
  } catch {
    logger.warn(
      `[Browser] screenshot failed (${host}, ${opts.fullPage ? "full page" : "visible"})`,
    );
    return "failed";
  }
  if (image.isEmpty()) return "failed";
  if (opts.target === "clipboard") {
    clipboard.writeImage(image);
    logger.info(`[Browser] screenshot copied (${host})`);
    return "copied";
  }
  const win = BrowserWindow.fromWebContents(sender);
  const options: Electron.SaveDialogOptions = {
    title: "Save Screenshot",
    defaultPath: join(app.getPath("downloads"), screenshotFileName(url, new Date())),
    filters: [
      { name: "PNG Image", extensions: ["png"] },
      { name: "JPEG Image", extensions: ["jpg", "jpeg"] },
    ],
  };
  const picked = win
    ? await dialog.showSaveDialog(win, options)
    : await dialog.showSaveDialog(options);
  if (picked.canceled || !picked.filePath) return "canceled";
  const jpeg = /\.jpe?g$/i.test(picked.filePath);
  const path = jpeg || /\.png$/i.test(picked.filePath) ? picked.filePath : `${picked.filePath}.png`;
  try {
    await writeFile(path, jpeg ? opaqueJpeg(image, 90) : image.toPNG());
  } catch (err) {
    // The code only: the message carries the chosen path (a home path)
    logger.warn(`[Browser] screenshot not saved (${host}): ${(err as { code?: string }).code}`);
    return "failed";
  }
  logger.info(`[Browser] screenshot saved (${host})`);
  return "saved";
}
