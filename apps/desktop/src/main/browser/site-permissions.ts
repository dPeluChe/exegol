/** Site permissions of pages in browser panes (location, notifications, camera, mic...): which
 *  ones ask the user, what a saved or one-time answer allows, and the requests waiting on a
 *  bar in the pane. Clipboard is clipboard-policy's. No Electron here */

import { PERMISSION_ANSWERS, type PermissionAnswer, type SiteDecision } from "@exegol/shared";
import { originOf } from "./clipboard-policy";
import { createPendingStore, MAX_PENDING_PER_PAGE, type PendingItem } from "./pending-store";

export const SITE_PERMISSIONS = [
  "geolocation",
  "notifications",
  "camera",
  "microphone",
  "midi",
  "idle-detection",
  "window-management",
  "external-app",
] as const;
export type SitePermission = (typeof SITE_PERMISSIONS)[number];

/** allow / deny without asking; ask: the bar decides `needs` (all of them) */
export type PermissionRoute =
  | { kind: "allow" }
  | { kind: "deny" }
  | { kind: "ask"; needs: SitePermission[] };

export const PERMISSION_TIMEOUT_MS = 120_000;

const ASKING: Record<string, SitePermission> = {
  geolocation: "geolocation",
  notifications: "notifications",
  midi: "midi",
  midiSysex: "midi",
  "idle-detection": "idle-detection",
  "window-management": "window-management",
  openExternal: "external-app",
};

/** Harmless or decided by the user's own action (fullscreen, a file they picked) */
const ALLOWED = new Set([
  "fullscreen",
  "pointerLock",
  "keyboardLock",
  "mediaKeySystem",
  "speaker-selection",
  "storage-access",
  "top-level-storage-access",
  "fileSystem",
]);

const CLIPBOARD = new Set([
  "clipboard-read",
  "clipboard-sanitized-write",
  "deprecated-sync-clipboard-read",
]);

/** null: clipboard, decided by clipboard-policy. Anything unknown (display-capture has no
 *  picker here, hid/serial/usb no chooser) is denied */
export function routePermission(
  permission: string,
  mediaTypes: readonly string[],
): PermissionRoute | null {
  if (CLIPBOARD.has(permission)) return null;
  if (ALLOWED.has(permission)) return { kind: "allow" };
  if (permission === "media") {
    const needs: SitePermission[] = [];
    if (mediaTypes.includes("video")) needs.push("camera");
    if (mediaTypes.includes("audio")) needs.push("microphone");
    return needs.length > 0 ? { kind: "ask", needs } : { kind: "deny" };
  }
  const one = ASKING[permission];
  return one ? { kind: "ask", needs: [one] } : { kind: "deny" };
}

const LABEL: Record<SitePermission, string> = {
  geolocation: "location",
  notifications: "notifications",
  camera: "camera",
  microphone: "microphone",
  midi: "MIDI devices",
  "idle-detection": "idle detection",
  "window-management": "window management",
  "external-app": "open other apps",
};

export const permissionLabel = (p: string): string => LABEL[p as SitePermission] ?? p;

const PROMPT: Record<SitePermission, string> = {
  geolocation: "use your location",
  notifications: "show notifications",
  camera: "use your camera",
  microphone: "use your microphone",
  midi: "use your MIDI devices",
  "idle-detection": "know when you are using this device",
  "window-management": "manage windows on your displays",
  "external-app": "open a link in another app",
};

/** The bar's sentence after "<host> wants to" */
export function permissionPrompt(needs: readonly SitePermission[]): string {
  if (needs.includes("camera") && needs.includes("microphone")) {
    return "use your camera and microphone";
  }
  return PROMPT[needs[0] ?? "external-app"];
}

/** scheme://host:port of http(s) pages; null for anything else (no saved answer for it) */
export function permissionOrigin(url: unknown): string | null {
  const o = originOf(url);
  return o && (o.startsWith("http://") || o.startsWith("https://")) ? o : null;
}

/** A page in a pane, on an http(s) origin (anything else is "denied (no pane)") */
export interface SitePermissionContext {
  agentActing: boolean;
  saved: Partial<Record<SitePermission, SiteDecision>>;
  /** Allowed once on this page and origin */
  grantedOnce: ReadonlySet<SitePermission>;
  /** Read only when it would ask */
  pendingOnPage: () => number;
}

export type SitePermissionOutcome =
  | "allowed (saved)"
  | "allowed (once)"
  | "blocked (saved)"
  | "denied (agent acting)"
  | "denied (no pane)"
  | "denied (too many)"
  | "ask";

/** Camera and mic never open while an agent drives the pane, even with a saved Allow */
const NEVER_WHILE_ACTING: ReadonlySet<SitePermission> = new Set(["camera", "microphone"]);

const allowedBy = (needs: readonly SitePermission[], c: SitePermissionContext) =>
  needs.every((p) => c.saved[p] === "allow" || c.grantedOnce.has(p));

export function decideSitePermission(
  needs: readonly SitePermission[],
  c: SitePermissionContext,
): SitePermissionOutcome {
  if (needs.some((p) => c.saved[p] === "block")) return "blocked (saved)";
  const mediaWhileActing = c.agentActing && needs.some((p) => NEVER_WHILE_ACTING.has(p));
  if (allowedBy(needs, c) && !mediaWhileActing) {
    return needs.every((p) => c.saved[p] === "allow") ? "allowed (saved)" : "allowed (once)";
  }
  if (c.agentActing) return "denied (agent acting)";
  if (c.pendingOnPage() >= MAX_PENDING_PER_PAGE) return "denied (too many)";
  return "ask";
}

export const isAllowed = (o: SitePermissionOutcome): boolean =>
  o === "allowed (saved)" || o === "allowed (once)";

export const answerAllows = (a: PermissionAnswer): boolean => a === "once" || a === "always";

export const isPermissionAnswer = (a: unknown): a is PermissionAnswer =>
  (PERMISSION_ANSWERS as readonly unknown[]).includes(a);

export const ANSWER_LOG: Record<PermissionAnswer, string> = {
  once: "allowed once",
  always: "allowed always",
  block: "blocked",
  deny: "denied",
};

export function permissionLog(needs: readonly SitePermission[], host: string, outcome: string) {
  return `[Browser] permission ${needs.join("+")} on ${host || "(no host)"}: ${outcome}`;
}

export interface PendingPermission extends PendingItem {
  paneId: string;
  projectId: string;
  origin: string;
  host: string;
  needs: SitePermission[];
  /** Each request for the same thing on the page waits on one bar */
  callbacks: ((granted: boolean) => void)[];
  timer: ReturnType<typeof setTimeout>;
}

const pending = createPendingStore<PendingPermission>();
const once = new Map<number, { origin: string; granted: Set<SitePermission> }>();

const sameNeeds = (a: readonly SitePermission[], b: readonly SitePermission[]) =>
  a.length === b.length && a.every((p) => b.includes(p));

export const findPendingPermission = (
  wcId: number,
  origin: string,
  needs: readonly SitePermission[],
): PendingPermission | undefined =>
  pending.find((p) => p.wcId === wcId && p.origin === origin && sameNeeds(p.needs, needs));

export function addPendingPermission(p: PendingPermission): void {
  pending.add(p);
}

export const getPendingPermission = (id: string): PendingPermission | undefined => pending.get(id);

export const pendingPermissionsOf = (wcId: number): number => pending.countOf(wcId);

/** Answers and forgets it; undefined when it is already gone */
export function settlePermission(
  id: string,
  granted: boolean,
  closeBar = false,
): PendingPermission | undefined {
  const p = pending.take(id);
  if (!p) return undefined;
  clearTimeout(p.timer);
  for (const cb of p.callbacks) cb(granted);
  if (closeBar) p.notifyClosed();
  return p;
}

/** The page went away (new document or webview gone): every request of it is denied */
export function denyPermissionsOf(wcId: number): void {
  for (const p of pending.of(wcId)) settlePermission(p.id, false, true);
}

export function grantOnce(wcId: number, origin: string, needs: readonly SitePermission[]): void {
  const cur = once.get(wcId);
  const granted = cur && cur.origin === origin ? cur.granted : new Set<SitePermission>();
  for (const p of needs) granted.add(p);
  once.set(wcId, { origin, granted });
}

export function grantedOnceOn(wcId: number, origin: string | null): ReadonlySet<SitePermission> {
  const cur = once.get(wcId);
  return cur && origin && cur.origin === origin ? cur.granted : new Set();
}

/** A one-time Allow lasts while the page stays on its origin */
export function forgetOnceUnless(wcId: number, origin: string | null): void {
  const cur = once.get(wcId);
  if (cur && cur.origin !== origin) once.delete(wcId);
}

export function forgetOnce(wcId: number): void {
  once.delete(wcId);
}
