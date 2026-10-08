/** Which page may open the mic or camera. Pages in browser panes never; the app's own main
 *  window only for audio, only while a dictation is starting (armed), only on the app origin */
export interface MediaRequest {
  permission: string;
  /** getUserMedia: "audio" / "video"; a permission check passes one as mediaType */
  mediaTypes: readonly string[];
  url: string;
  isMainWindow: boolean;
  appOrigin: string;
  armed: boolean;
}

function sameOrigin(url: string, appOrigin: string): boolean {
  if (appOrigin === "file://") return url.startsWith("file://");
  try {
    return new URL(url).origin === appOrigin;
  } catch {
    return false;
  }
}

/** Anything but media keeps Electron's default (allowed) */
export function allowMediaRequest(r: MediaRequest): boolean {
  if (r.permission !== "media") return true;
  return (
    r.isMainWindow &&
    r.armed &&
    sameOrigin(r.url, r.appOrigin) &&
    r.mediaTypes.length > 0 &&
    r.mediaTypes.every((t) => t === "audio")
  );
}
