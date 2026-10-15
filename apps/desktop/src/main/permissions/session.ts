import { app, type Session, session } from "electron";
import { checkPagePermission, requestPagePermission } from "../browser/page-permissions";
import { isPage } from "../browser/webview-guard";
import { appPermissionDecision } from "../dictation/mic";

const guarded = new WeakSet<Session>();

/** One request and one check handler per session: browser pane pages by their pane's
 *  permission bar and clipboard policy, app windows by the dictation media policy */
function guardSession(ses: Session): void {
  if (guarded.has(ses)) return;
  guarded.add(ses);
  ses.setPermissionRequestHandler((wc, permission, callback, details) => {
    const media = "mediaTypes" in details ? (details.mediaTypes ?? []) : [];
    const url = details.requestingUrl ?? wc.getURL();
    if (isPage(wc)) requestPagePermission(wc, permission, media, url, callback);
    else callback(appPermissionDecision(wc, permission, media, url));
  });
  ses.setPermissionCheckHandler((wc, permission, origin, details) => {
    const media = details.mediaType ? [details.mediaType] : [];
    const url = details.requestingUrl ?? origin;
    return isPage(wc)
      ? checkPagePermission(wc, permission, media, url)
      : appPermissionDecision(wc, permission, media, url, true);
  });
}

/** Every session: the default one and each project's browser partition */
export function installSessionPermissions(): void {
  guardSession(session.defaultSession);
  app.on("session-created", guardSession);
}
