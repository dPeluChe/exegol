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

export type ScreenshotTarget = "file" | "clipboard";
export type ScreenshotResult = "saved" | "copied" | "canceled" | "failed";

/** Past this the GPU texture can fail and the image comes back blank */
const FULL_PAGE_MAX_HEIGHT = 16_384;

/** The whole document through CDP (captureBeyondViewport), without resizing the pane. A page
 *  whose own scroll container holds the content still yields only what is on screen */
async function captureFullPage(wc: WebContents): Promise<NativeImage> {
  const dbg = wc.debugger;
  const wasAttached = dbg.isAttached();
  if (!wasAttached) dbg.attach("1.3");
  try {
    const metrics = (await dbg.sendCommand("Page.getLayoutMetrics")) as {
      cssContentSize?: { width: number; height: number };
      contentSize: { width: number; height: number };
    };
    const size = metrics.cssContentSize ?? metrics.contentSize;
    const shot = (await dbg.sendCommand("Page.captureScreenshot", {
      format: "png",
      captureBeyondViewport: true,
      clip: {
        x: 0,
        y: 0,
        width: Math.ceil(size.width),
        height: Math.min(Math.ceil(size.height), FULL_PAGE_MAX_HEIGHT),
        scale: 1,
      },
    })) as { data: string };
    return nativeImage.createFromBuffer(Buffer.from(shot.data, "base64"));
  } finally {
    if (!wasAttached && dbg.isAttached()) dbg.detach();
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
    await writeFile(path, jpeg ? image.toJPEG(90) : image.toPNG());
  } catch (err) {
    // The code only: the message carries the chosen path (a home path)
    logger.warn(`[Browser] screenshot not saved (${host}): ${(err as { code?: string }).code}`);
    return "failed";
  }
  logger.info(`[Browser] screenshot saved (${host})`);
  return "saved";
}
