/** Which page may open the mic or camera. Pages in browser panes never; the app's own main
 *  window only for audio, only while a dictation is starting (armed), only on the app origin.
 *  An app window (Settings) also once right after its mic Test button armed it (micTest) */
export interface MediaRequest {
  permission: string;
  /** getUserMedia: "audio" / "video"; a permission check passes one as mediaType */
  mediaTypes: readonly string[];
  url: string;
  isMainWindow: boolean;
  appOrigin: string;
  armed: boolean;
  /** A permission check (enumerateDevices labels, permissions.query), not a getUserMedia */
  check?: boolean;
  /** Any Exegol window (Settings, floating) on the app origin, never a browser pane's page */
  isAppWindow?: boolean;
  /** This window pressed Settings > Dictation > Input's Test within the last few seconds */
  micTest?: boolean;
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
  const audioOnly = r.mediaTypes.length > 0 && r.mediaTypes.every((t) => t === "audio");
  // Settings > Dictation lists the mics by name; a check opens nothing
  if (r.check && r.isAppWindow && audioOnly && sameOrigin(r.url, r.appOrigin)) return true;
  if (r.micTest && r.isAppWindow && audioOnly && sameOrigin(r.url, r.appOrigin)) return true;
  return (
    r.isMainWindow &&
    r.armed &&
    sameOrigin(r.url, r.appOrigin) &&
    r.mediaTypes.length > 0 &&
    r.mediaTypes.every((t) => t === "audio")
  );
}
