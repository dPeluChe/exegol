import { chmodSync, mkdirSync, readdirSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { isOutsideAllowlist } from "@exegol/shared";
import type Database from "libsql";
import { EXEGOL_DIR, ExegolToolError } from "../mcp/exegol-protocol";
import { getPaneControl } from "./control";
import {
  allowedHostsOf,
  type BrowserPaneHandle,
  type BrowserToolContext,
  inspect,
  needsUserResult,
  PAGE_CHANGED,
  pageUnavailable,
} from "./tool-guards";

const MAX_INLINE_IMAGE_BYTES = 1_500_000;
const SCREENSHOTS_DIR = join(EXEGOL_DIR, "screenshots");
const SCREENSHOT_MAX_AGE_MS = 24 * 60 * 60_000;
const SCREENSHOTS_KEPT = 50;

/** The last day's screenshots, at most SCREENSHOTS_KEPT of them */
function pruneScreenshots(now: number): void {
  try {
    const files = readdirSync(SCREENSHOTS_DIR)
      .map((name) => {
        const path = join(SCREENSHOTS_DIR, name);
        return { path, mtime: statSync(path).mtimeMs };
      })
      .sort((a, b) => b.mtime - a.mtime);
    files.forEach((f, i) => {
      if (i >= SCREENSHOTS_KEPT || now - f.mtime > SCREENSHOT_MAX_AGE_MS) unlinkSync(f.path);
    });
  } catch {
    /* best-effort */
  }
}

export async function handleScreenshot(
  db: Database.Database,
  ctx: BrowserToolContext,
  pane: BrowserPaneHandle,
  args: Record<string, unknown>,
) {
  const { page, needsUser, loadFailed } = await inspect(db, ctx, pane);
  // A login the user is filling in holds what they type, like a one-time code
  const typing = needsUser && getPaneControl(pane.paneId)?.userHasControl;
  if (!page || typing) return pageUnavailable(pane, needsUser, loadFailed);
  const jpeg = await pane.capture(args.full_page === true);
  // The page may have left the allowed hosts while it was being captured
  const url = pane.getUrl();
  if (isOutsideAllowlist(url, allowedHostsOf(db, ctx.projectId))) {
    const after = await inspect(db, ctx, pane);
    if (after.needsUser) return needsUserResult(pane, after.needsUser);
    throw new ExegolToolError(PAGE_CHANGED, -32025);
  }
  mkdirSync(SCREENSHOTS_DIR, { recursive: true, mode: 0o700 });
  chmodSync(SCREENSHOTS_DIR, 0o700);
  const now = Date.now();
  pruneScreenshots(now);
  const path = join(SCREENSHOTS_DIR, `${ctx.agentId}-${now}.jpg`);
  writeFileSync(path, jpeg, { mode: 0o600 });
  const info = { pane: pane.paneId, url, path, bytes: jpeg.length };
  if (jpeg.length <= MAX_INLINE_IMAGE_BYTES) {
    return {
      __mcpContent: [
        { type: "image", data: jpeg.toString("base64"), mimeType: "image/jpeg" },
        { type: "text", text: JSON.stringify(info) },
      ],
    };
  }
  return { ...info, hint: "Read the JPEG at path to see it." };
}
