import { randomUUID } from "node:crypto";
import type { PermissionAnswer, SiteDecision, SitePermissionRow } from "@exegol/shared";
import { ipcMain, type WebContents } from "electron";
import type Database from "libsql";
import { coreRust } from "../agents/spawn-env";
import {
  deleteBrowserPermission,
  listBrowserPermissions,
  saveBrowserPermission,
} from "../db/queries/browser-permissions";
import { createLogLimiter, suppressedNote } from "../lib/log-limiter";
import { logger } from "../lib/logger";
import { isAgentActing } from "./control";
import { dialogHost } from "./page-dialogs";
import { pageClipboardDecision } from "./page-events";
import {
  ANSWER_LOG,
  addPendingPermission,
  answerAllows,
  decideSitePermission,
  findPendingPermission,
  getPendingPermission,
  grantedOnceOn,
  grantOnce,
  isAllowed,
  isPermissionAnswer,
  PERMISSION_TIMEOUT_MS,
  pendingPermissionsOf,
  permissionLabel,
  permissionLog,
  permissionOrigin,
  permissionPrompt,
  routePermission,
  type SitePermission,
  type SitePermissionContext,
  settlePermission,
} from "./site-permissions";
import { hostedBy, sendTo } from "./webview-guard";

type PaneLookup = (wcId: number) => { paneId: string; projectId: string } | undefined;

let paneOf: PaneLookup = () => undefined;
let dbRef: Database.Database | null = null;
const saved = new Map<string, Map<string, SiteDecision>>();
/** Saved answers apply on every request (watchPosition): one line per page and minute */
const quiet = createLogLimiter(60_000);
/** macOS asks once; afterwards only System Settings changes it */
let systemLocation = "not-determined";

const savedKey = (origin: string, permission: string) => `${origin} ${permission}`;

function savedOf(projectId: string): Map<string, SiteDecision> {
  let m = saved.get(projectId);
  if (!m && dbRef) {
    m = new Map(
      listBrowserPermissions(dbRef, projectId).map((r) => [
        savedKey(r.origin, r.permission),
        r.decision,
      ]),
    );
    saved.set(projectId, m);
  }
  return m ?? new Map();
}

/** null: no pane or no http(s) origin, denied */
function contextOf(wc: WebContents, origin: string | null, needs: readonly SitePermission[]) {
  const pane = paneOf(wc.id);
  if (!pane || !origin) return null;
  const own = savedOf(pane.projectId);
  const savedFor: SitePermissionContext["saved"] = {};
  for (const p of needs) {
    const d = own.get(savedKey(origin, p));
    if (d) savedFor[p] = d;
  }
  const c: SitePermissionContext = {
    agentActing: isAgentActing(pane.paneId),
    saved: savedFor,
    grantedOnce: grantedOnceOn(wc.id, origin),
    pendingOnPage: () => pendingPermissionsOf(wc.id),
  };
  return { pane, origin, c };
}

/** Chromium never asks macOS for Location Services: without this the page's request hangs */
function ensureSystemLocation(wc: WebContents, paneId: string, needs: readonly SitePermission[]) {
  if (!needs.includes("geolocation") || systemLocation !== "not-determined") return;
  // Optional: a native module built before this export lacks it
  if (process.platform !== "darwin" || !coreRust?.locationAuthorization) return;
  try {
    systemLocation = coreRust.locationAuthorization(true);
  } catch {
    return;
  }
  if (systemLocation === "not-determined")
    logger.info("[Browser] location: asked macOS for access");
  if (systemLocation === "denied" || systemLocation === "restricted") {
    logger.info(`[Browser] location: macOS Location Services ${systemLocation} for Exegol`);
    sendTo(wc.hostWebContents ?? null, "browser:permission-notice", {
      paneId,
      kind: "location-off",
    });
  }
}

/** A browser pane page's permission request: clipboard by its policy, the rest by the pane's
 *  permission bar (never silent) */
export function requestPagePermission(
  wc: WebContents,
  permission: string,
  mediaTypes: readonly string[],
  url: string,
  callback: (granted: boolean) => void,
): void {
  const route = routePermission(permission, mediaTypes);
  if (!route) {
    callback(pageClipboardDecision(wc, permission, url));
    return;
  }
  if (route.kind !== "ask") {
    callback(route.kind === "allow");
    return;
  }
  const { needs } = route;
  const origin = permissionOrigin(url);
  const hostOf = () => dialogHost(origin ?? url);
  const ctx = contextOf(wc, origin, needs);
  const outcome = ctx ? decideSitePermission(needs, ctx.c) : "denied (no pane)";
  if (outcome !== "ask" || !ctx) {
    const ok = isAllowed(outcome);
    const skipped = quiet.take(`${wc.id} ${needs.join("+")} ${outcome}`, Date.now());
    if (skipped !== null) {
      logger.info(`${permissionLog(needs, hostOf(), outcome)}${suppressedNote(skipped)}`);
    }
    if (ok && ctx) ensureSystemLocation(wc, ctx.pane.paneId, needs);
    callback(ok);
    return;
  }
  const same = findPendingPermission(wc.id, ctx.origin, needs);
  if (same) {
    same.callbacks.push(callback);
    return;
  }
  const { pane } = ctx;
  const host = hostOf();
  // Captured now: on teardown hostWebContents is gone
  const hostWc = wc.hostWebContents ?? null;
  const id = randomUUID();
  addPendingPermission({
    id,
    wcId: wc.id,
    paneId: pane.paneId,
    projectId: pane.projectId,
    origin: ctx.origin,
    host,
    needs,
    callbacks: [callback],
    notifyClosed: () => sendTo(hostWc, "browser:permission-closed", { id }),
    timer: setTimeout(() => {
      if (settlePermission(id, false, true)) logger.info(permissionLog(needs, host, "timeout"));
    }, PERMISSION_TIMEOUT_MS),
  });
  sendTo(hostWc, "browser:permission-request", {
    id,
    paneId: pane.paneId,
    host,
    what: permissionPrompt(needs),
  });
}

/** Sync checks (permissions.query, Notification.permission, device labels) of a pane's page */
export function checkPagePermission(
  wc: WebContents,
  permission: string,
  mediaTypes: readonly string[],
  url: string,
): boolean {
  const route = routePermission(permission, mediaTypes);
  if (!route) return pageClipboardDecision(wc, permission, url);
  if (route.kind !== "ask") return route.kind === "allow";
  const ctx = contextOf(wc, permissionOrigin(url), route.needs);
  return !!ctx && isAllowed(decideSitePermission(route.needs, ctx.c));
}

function answer(sender: WebContents, input: { id?: unknown; answer?: unknown }): boolean {
  if (typeof input?.id !== "string" || !isPermissionAnswer(input.answer)) return false;
  const p = getPendingPermission(input.id);
  const wc = hostedBy(sender, p);
  if (!p || !wc) return false;
  const a: PermissionAnswer = input.answer;
  if (dbRef && (a === "always" || a === "block")) {
    const db = dbRef;
    const decision: SiteDecision = a === "block" ? "block" : "allow";
    db.transaction(() => {
      for (const perm of p.needs) saveBrowserPermission(db, p.projectId, p.origin, perm, decision);
    })();
    for (const perm of p.needs) saved.get(p.projectId)?.set(savedKey(p.origin, perm), decision);
  }
  if (a === "once") grantOnce(p.wcId, p.origin, p.needs);
  logger.info(permissionLog(p.needs, p.host, ANSWER_LOG[a]));
  const ok = answerAllows(a);
  settlePermission(p.id, ok);
  if (ok) ensureSystemLocation(wc, p.paneId, p.needs);
  return true;
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
  saved.get(projectId)?.delete(savedKey(origin, permission));
  if (removed)
    logger.info(`[Browser] permission ${permission} on ${dialogHost(origin)}: forgotten`);
  return removed;
}

/** The project is gone: its rows went with it (cascade) */
export function forgetProjectPermissions(projectId: string): void {
  saved.delete(projectId);
}

export function installPagePermissions(db: Database.Database, lookup: PaneLookup): void {
  dbRef = db;
  paneOf = lookup;
  ipcMain.handle("browser:permission-answer", (event, input) => answer(event.sender, input ?? {}));
}
