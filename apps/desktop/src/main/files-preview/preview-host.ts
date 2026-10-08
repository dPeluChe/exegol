import type { FileHandle } from "node:fs/promises";
import { Readable } from "node:stream";
import { PREVIEW_PARTITION } from "@exegol/shared";
import { protocol, type Session, session, type WebContents, type WebPreferences } from "electron";
import type Database from "libsql";
import { openPinned } from "../ipc/procedures/terminal-links";
import { mimeFor } from "../lib/mime";
import { previewBases } from "./bases";
import {
  dropPreviewGrant,
  isLiveRoot,
  isPreviewUrl,
  isRecentGesture,
  linkNotice,
  PREVIEW_SCHEME,
  parseRange,
  previewCsp,
  previewGrant,
  previewTokenOf,
  refusalMessage,
  resolvePreviewFile,
  segmentsFromUrlPath,
} from "./preview-paths";

let previewSession: Session | null = null;

export const isPreviewSession = (ses: Session) => previewSession !== null && ses === previewSession;

/** Before app ready: standard, so relative URLs resolve per token and a token is one origin */
export function registerPreviewScheme(): void {
  protocol.registerSchemesAsPrivileged([
    { scheme: PREVIEW_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true } },
  ]);
}

const plain = (status: number, text?: string, headers: Record<string, string> = {}) =>
  new Response(text ?? null, {
    status,
    headers: text ? { "Content-Type": "text/plain; charset=utf-8", ...headers } : headers,
  });

/** One file, read-only, from the grant's root: opened once, then streamed (Range for media) */
async function servePreview(db: Database.Database, req: Request): Promise<Response> {
  if (req.method !== "GET" && req.method !== "HEAD") return plain(405);
  const url = new URL(req.url);
  const token = url.hostname;
  const grant = previewGrant(token);
  if (!grant) return plain(404);
  if (!(await isLiveRoot(grant.root, previewBases(db)))) {
    dropPreviewGrant(token);
    return plain(404);
  }
  const segments = segmentsFromUrlPath(url.pathname);
  const file = segments
    ? await resolvePreviewFile(grant.root, segments)
    : ({ ok: false, reason: "bad-path" } as const);
  if (!file.ok) return plain(file.reason === "not-a-file" ? 404 : 403, refusalMessage(file));

  let handle: FileHandle;
  try {
    handle = await openPinned(file.path);
  } catch {
    return plain(404);
  }
  const { size } = await handle.stat();
  const range = parseRange(req.headers.get("range"), size);
  if (range === "unsatisfiable") {
    await handle.close();
    return plain(416, undefined, { "Content-Range": `bytes */${size}` });
  }
  const start = range?.start ?? 0;
  const end = range?.end ?? size - 1;
  const headers: Record<string, string> = {
    "Content-Type": mimeFor(file.path),
    "Content-Length": String(size === 0 ? 0 : end - start + 1),
    "Accept-Ranges": "bytes",
    "Content-Security-Policy": previewCsp(grant.scripts),
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "Cache-Control": "no-store",
  };
  if (range) headers["Content-Range"] = `bytes ${start}-${end}/${size}`;
  const status = range ? 206 : 200;
  if (req.method === "HEAD" || size === 0) {
    await handle.close();
    return new Response(null, { status, headers });
  }
  const body = Readable.toWeb(handle.createReadStream({ start, end })) as ReadableStream;
  return new Response(body, { status, headers });
}

/**
 * The preview's own in-memory session: the scheme exists only here (not in the app's session),
 * nothing else loads, no permission, download or proxy-less socket.
 */
export function installPreviewSession(db: Database.Database): void {
  const ses = session.fromPartition(PREVIEW_PARTITION);
  previewSession = ses;
  ses.protocol.handle(PREVIEW_SCHEME, (req) => servePreview(db, req));
  // Electron keeps one onBeforeRequest listener per session; this session has no other user
  ses.webRequest.onBeforeRequest((d, callback) => {
    callback({ cancel: !isPreviewUrl(d.url) && !/^(data|blob):/.test(d.url) });
  });
  ses.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  ses.setPermissionCheckHandler(() => false);
  ses.setDevicePermissionHandler(() => false);
  ses.on("will-download", (event) => event.preventDefault());
  ses.setSpellCheckerEnabled(false);
  // A dead proxy for everything (loopback too): what the request guard does not see, such as
  // WebRTC over TCP, has nowhere to go. UDP is off per page (disable_non_proxied_udp)
  void ses
    .setProxy({ proxyRules: "http://127.0.0.1:9", proxyBypassRules: "<-loopback>" })
    .catch(() => {});
}

/** will-attach-webview for the preview partition: main sets every preference, scripts from the
 *  token's grant. Anything but a granted preview URL is refused */
export function attachPreviewWebview(
  event: Electron.Event,
  prefs: WebPreferences,
  params: Record<string, string>,
): void {
  const grant = previewGrant(previewTokenOf(params.src));
  if (!grant) {
    event.preventDefault();
    return;
  }
  delete prefs.preload;
  delete params.allowpopups;
  Object.assign(prefs, {
    nodeIntegration: false,
    nodeIntegrationInSubFrames: false,
    contextIsolation: true,
    sandbox: true,
    webSecurity: true,
    allowRunningInsecureContent: false,
    webviewTag: false,
    plugins: false,
    experimentalFeatures: false,
    navigateOnDragDrop: false,
    spellcheck: false,
    disableDialogs: true,
    javascript: grant.scripts,
  } satisfies WebPreferences);
}

const LINK_REPEAT_MS = 2_000;

/** A preview page stays on its token. A link elsewhere reaches the host's link bar only right
 *  after a click or key press in the page, once per URL in a short window */
export function guardPreviewContents(contents: WebContents): void {
  contents.setWebRTCIPHandlingPolicy("disable_non_proxied_udp");
  contents.setWindowOpenHandler(() => ({ action: "deny" }));
  let gestureAt: number | undefined;
  let last = { url: "", at: 0 };
  contents.on("input-event", (_e, input) => {
    if (input.type === "mouseDown" || input.type === "rawKeyDown" || input.type === "keyDown") {
      gestureAt = Date.now();
    }
  });
  contents.on("will-frame-navigate", (event) => {
    const current = previewTokenOf(contents.getURL());
    if (isPreviewUrl(event.url) && (current === "" || current === previewTokenOf(event.url))) {
      return;
    }
    event.preventDefault();
    const notice = linkNotice(event.url);
    const now = Date.now();
    if (!notice || !isRecentGesture(gestureAt, now)) return;
    if (notice.url === last.url && now - last.at < LINK_REPEAT_MS) return;
    last = { url: notice.url, at: now };
    contents.hostWebContents?.send("files-preview:link", { from: contents.getURL(), ...notice });
  });
}
