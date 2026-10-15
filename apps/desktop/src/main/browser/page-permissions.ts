import { randomUUID } from "node:crypto";
import { ipcMain, type WebContents, webContents } from "electron";
import type Database from "libsql";
import { coreRust } from "../agents/spawn-env";
import {
  deleteBrowserPermission,
  listBrowserPermissions,
  type SavedSitePermission,
  saveBrowserPermission,
} from "../db/queries/browser-permissions";
import { createLogLimiter } from "../lib/log-limiter";
import { logger } from "../lib/logger";
import { isAgentActing } from "./control";
import { dialogHost } from "./page-dialogs";
import {
  addPendingPermission,
  answerAllows,
  answerLog,
  checkSitePermission,
  decideSitePermission,
  denyPermissionsOf,
  findPendingPermission,
  forgetOnce,
  forgetOnceUnless,
  getPendingPermission,
  grantedOnceOn,
  grantOnce,
  isPermissionAnswer,
  PERMISSION_TIMEOUT_MS,
  type PermissionAnswer,
  pendingPermissionsOf,
  permissionLabel,
  permissionLog,
  permissionOrigin,
  permissionPrompt,
  routePermission,
  type SiteDecision,
  type SitePermission,
  type SitePermissionContext,
  settlePermission,
} from "./site-permissions";

type PaneLookup = (wcId: number) => { paneId: string; projectId: string } | undefined;

let paneOf: PaneLookup = () => undefined;
let dbRef: Database.Database | null = null;
const saved = new Map<string, Map<string, SiteDecision>>();
/** Saved answers apply on every request (watchPosition): one line per page and minute */
const quiet = createLogLimiter(60_000);
let locationNoticeSent = false;

const isPage = (wc: WebContents | null): wc is WebContents =>
  !!wc && !wc.isDestroyed() && wc.getType() === "webview";

function savedOf(projectId: string): Map<string, SiteDecision> {
  let m = saved.get(projectId);
  if (!m && dbRef) {
    m = new Map(
      listBrowserPermissions(dbRef, projectId).map((r) => [
        `${r.origin} ${r.permission}`,
        r.decision,
      ]),
    );
    saved.set(projectId, m);
  }
  return m ?? new Map();
}

function contextOf(
  wc: WebContents,
  origin: string | null,
  needs: readonly SitePermission[],
): SitePermissionContext & { pane?: { paneId: string; projectId: string } } {
  const pane = paneOf(wc.id);
  const own = pane && origin ? savedOf(pane.projectId) : new Map<string, SiteDecision>();
  const savedFor: SitePermissionContext["saved"] = {};
  for (const p of needs) {
    const d = own.get(`${origin} ${p}`);
    if (d) savedFor[p] = d;
  }
  return {
    pane,
    hasPane: !!pane,
    hasOrigin: !!origin,
    agentActing: !!pane && isAgentActing(pane.paneId),
    saved: savedFor,
    grantedOnce: grantedOnceOn(wc.id, origin),
    pendingOnPage: pendingPermissionsOf(wc.id),
  };
}

function sendTo(host: WebContents | null, channel: string, payload: unknown): void {
  if (host && !host.isDestroyed()) host.send(channel, payload);
}

/** Chromium never asks macOS for Location Services: without this the page's request hangs */
function ensureSystemLocation(wc: WebContents, paneId: string): void {
  // Optional: a native module built before this export lacks it
  const native = coreRust as unknown as {
    locationAuthorization?: (request: boolean) => string;
  } | null;
  if (process.platform !== "darwin" || !native?.locationAuthorization) return;
  let status: string;
  try {
    status = native.locationAuthorization(true);
  } catch {
    return;
  }
  if (status === "not-determined") logger.info("[Browser] location: asked macOS for access");
  if ((status === "denied" || status === "restricted") && !locationNoticeSent) {
    locationNoticeSent = true;
    logger.info(`[Browser] location: macOS Location Services ${status} for Exegol`);
    sendTo(wc.hostWebContents ?? null, "browser:permission-notice", {
      paneId,
      kind: "location-off",
    });
  }
}

function granted(wc: WebContents, paneId: string, needs: readonly SitePermission[]): void {
  if (needs.includes("geolocation")) ensureSystemLocation(wc, paneId);
}

/** A webview's permission request. false: not a page's site permission (the app windows' and
 *  clipboard rules decide it) */
export function requestPagePermission(
  wc: WebContents | null,
  permission: string,
  mediaTypes: readonly string[],
  url: string,
  callback: (granted: boolean) => void,
): boolean {
  if (!isPage(wc)) return false;
  const route = routePermission(permission, mediaTypes);
  if (!route) return false;
  if (route.kind !== "ask") {
    callback(route.kind === "allow");
    return true;
  }
  const { needs } = route;
  const origin = permissionOrigin(url);
  const host = dialogHost(url);
  const c = contextOf(wc, origin, needs);
  const outcome = decideSitePermission(needs, c);
  if (outcome !== "ask") {
    const ok = outcome.startsWith("allowed");
    const skipped = quiet.take(`${wc.id} ${needs.join("+")} ${outcome}`, Date.now());
    if (skipped !== null) {
      const more = skipped > 0 ? ` (+${skipped} suppressed)` : "";
      logger.info(`${permissionLog(needs, host, outcome)}${more}`);
    }
    if (ok && c.pane) granted(wc, c.pane.paneId, needs);
    callback(ok);
    return true;
  }
  const pane = c.pane;
  if (!pane || !origin) {
    callback(false);
    return true;
  }
  const same = findPendingPermission(wc.id, origin, needs);
  if (same) {
    same.callbacks.push(callback);
    return true;
  }
  // Captured now: on teardown hostWebContents is gone
  const hostWc = wc.hostWebContents ?? null;
  const id = randomUUID();
  addPendingPermission({
    id,
    wcId: wc.id,
    paneId: pane.paneId,
    projectId: pane.projectId,
    origin,
    host,
    needs,
    callbacks: [callback],
    notifyClosed: () => sendTo(hostWc, "browser:permission-closed", { id }),
    timer: setTimeout(() => {
      const p = settlePermission(id, false);
      if (!p) return;
      p.notifyClosed?.();
      logger.info(permissionLog(needs, host, "timeout"));
    }, PERMISSION_TIMEOUT_MS),
  });
  sendTo(hostWc, "browser:permission-request", {
    id,
    paneId: pane.paneId,
    host,
    what: permissionPrompt(needs),
  });
  return true;
}

/** Sync checks (permissions.query, Notification.permission, device labels). null: not a page */
export function checkPagePermission(
  wc: WebContents | null,
  permission: string,
  mediaTypes: readonly string[],
  url: string,
): boolean | null {
  if (!isPage(wc)) return null;
  const route = routePermission(permission, mediaTypes);
  if (!route) return null;
  if (route.kind !== "ask") return route.kind === "allow";
  const origin = permissionOrigin(url);
  return checkSitePermission(route.needs, contextOf(wc, origin, route.needs));
}

/** One-time grants follow the page's origin; a new document drops the bars of the old one */
export function trackPagePermissions(wc: WebContents): void {
  const id = wc.id;
  wc.on("did-navigate", (_e, url) => {
    denyPermissionsOf(id);
    forgetOnceUnless(id, permissionOrigin(url));
  });
  wc.once("destroyed", () => {
    denyPermissionsOf(id);
    forgetOnce(id);
  });
}

function answer(sender: WebContents, input: { id?: unknown; answer?: unknown }): boolean {
  if (typeof input?.id !== "string" || !isPermissionAnswer(input.answer)) return false;
  const p = getPendingPermission(input.id);
  const wc = p ? webContents.fromId(p.wcId) : undefined;
  if (!p || !wc || wc.isDestroyed() || wc.hostWebContents !== sender) return false;
  const a: PermissionAnswer = input.answer;
  if (dbRef && (a === "always" || a === "block")) {
    const decision = a === "block" ? "block" : "allow";
    for (const perm of p.needs) saveBrowserPermission(dbRef, p.projectId, p.origin, perm, decision);
    saved.delete(p.projectId);
  }
  if (a === "once") grantOnce(p.wcId, p.origin, p.needs);
  logger.info(permissionLog(p.needs, p.host, answerLog(a)));
  const ok = answerAllows(a);
  settlePermission(p.id, ok);
  if (ok) granted(wc, p.paneId, p.needs);
  return true;
}

export interface SitePermissionRow extends SavedSitePermission {
  label: string;
}

export function listSitePermissions(db: Database.Database, projectId: string): SitePermissionRow[] {
  return listBrowserPermissions(db, projectId).map((r) => ({
    ...r,
    label: permissionLabel(r.permission),
  }));
}

export function forgetSitePermission(
  db: Database.Database,
  projectId: string,
  origin: string,
  permission: string,
): boolean {
  const removed = deleteBrowserPermission(db, projectId, origin, permission);
  saved.delete(projectId);
  if (removed)
    logger.info(`[Browser] permission ${permission} on ${dialogHost(origin)}: forgotten`);
  return removed;
}

export function installPagePermissions(db: Database.Database, lookup: PaneLookup): void {
  dbRef = db;
  paneOf = lookup;
  ipcMain.handle("browser:permission-answer", (event, input) => answer(event.sender, input ?? {}));
}
