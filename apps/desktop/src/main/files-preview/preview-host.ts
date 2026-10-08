import { readFile, stat } from "node:fs/promises";
import { protocol, session, type WebContents, type WebFrameMain } from "electron";
import {
  PREVIEW_SCHEME,
  previewCsp,
  previewGrant,
  previewMime,
  resolvePreviewFile,
} from "./preview-paths";

const MAX_PREVIEW_FILE = 50 * 1024 * 1024;

const isPreviewUrl = (url: string | undefined) => !!url?.startsWith(`${PREVIEW_SCHEME}://`);

function frameUrl(frame: WebFrameMain | null | undefined): string {
  try {
    return frame?.url ?? "";
  } catch {
    return ""; // a disposed frame throws
  }
}

/** Before app ready: standard (relative URLs resolve per token), secure, CORS for fonts/modules */
export function registerPreviewScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: PREVIEW_SCHEME,
      privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true },
    },
  ]);
}

const status = (code: number) => new Response(null, { status: code });

/** Read-only file server for the Files preview, plus the guard that keeps its frames offline */
export function installPreviewProtocol(): void {
  protocol.handle(PREVIEW_SCHEME, async (req) => {
    if (req.method !== "GET" && req.method !== "HEAD") return status(405);
    const url = new URL(req.url);
    const grant = previewGrant(url.hostname);
    if (!grant) return status(404);
    const file = await resolvePreviewFile(grant.root, url.pathname);
    if (!file) return status(404);
    const info = await stat(file).catch(() => null);
    if (!info) return status(404);
    if (info.size > MAX_PREVIEW_FILE) return status(413);
    const body = req.method === "HEAD" ? null : await readFile(file);
    return new Response(body, {
      headers: {
        "Content-Type": previewMime(file),
        "Content-Security-Policy": previewCsp(grant.scripts),
        "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "no-referrer",
        "Cache-Control": "no-store",
        // The sandboxed frame has an opaque origin: fonts and module scripts load in CORS mode
        "Access-Control-Allow-Origin": "*",
      },
    });
  });
  // Defense in depth behind the CSP: nothing a preview frame asks for leaves the scheme
  session.defaultSession.webRequest.onBeforeRequest((d, callback) => {
    callback({ cancel: !isPreviewUrl(d.url) && isPreviewUrl(frameUrl(d.frame)) });
  });
}

/** A preview frame never navigates away; an http(s) link goes to the renderer, which opens it
 *  only when the user clicks there */
export function guardPreviewFrames(contents: WebContents): void {
  contents.on("will-frame-navigate", (event) => {
    if (event.isMainFrame || isPreviewUrl(event.url)) return;
    const from = frameUrl(event.frame);
    if (!isPreviewUrl(from)) return;
    event.preventDefault();
    if (/^https?:\/\//i.test(event.url)) {
      contents.send("files-preview:link", { url: event.url, from });
    }
  });
}
