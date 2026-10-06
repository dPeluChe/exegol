import { checkAgentUrl, isOutsideAllowlist, needsUserReason } from "@exegol/shared";
import type Database from "libsql";
import { getAgent } from "../db/queries/agents";
import { getProject } from "../db/queries/projects";
import { ExegolToolError } from "../mcp/exegol-protocol";
import { getPaneControl, lastPaneOf, noteAgentAction, setNeedsUser } from "./control";
import type { LogRing } from "./log-ring";
import { detectNeedsUser, type NeedsUser } from "./needs-user";
import { type RawSignals, type RawSnapshot, signalsScript, snapshotScript } from "./page-scripts";

/** One live browser pane as the tools see it. The host only hands out panes whose webview runs
 *  in the asked project's own partition, so a pane id from another project never resolves */
export interface BrowserPaneHandle {
  paneId: string;
  projectId: string;
  getUrl(): string;
  getTitle(): string;
  runIsolated(code: string): Promise<unknown>;
  runMain(code: string, timeoutMs: number): Promise<unknown>;
  loadUrl(url: string): Promise<void>;
  /** JPEG, at most 1280px wide */
  capture(): Promise<Buffer>;
  sendKey(keyCode: string, modifiers: string[]): void;
  lastHttpStatus(): number | null;
  logs: LogRing;
}

export interface BrowserHost {
  livePanes(projectId: string): BrowserPaneHandle[];
  openPane(req: { projectId: string; agentId: string; url: string }): Promise<BrowserPaneHandle>;
  devServerUrl(projectId: string): Promise<string | null>;
}

export interface BrowserToolContext {
  agentId: string;
  projectId: string;
  accessMode: "read" | "plan" | "write";
}

let host: BrowserHost | null = null;
export function setBrowserHost(h: BrowserHost | null): void {
  host = h;
}

export function requireHost(): BrowserHost {
  if (!host) throw new ExegolToolError("The browser is not available (no Exegol window)", -32603);
  return host;
}

type NeedsUserNotifier = (ctx: BrowserToolContext, alias: string | null, what: string) => void;
let notifyUser: NeedsUserNotifier = () => {};
/** browser_wait_for_user's alert (the in-app item comes from the pane state) */
export function setNeedsUserNotifier(fn: NeedsUserNotifier): void {
  notifyUser = fn;
}
export const notifyNeedsUser: NeedsUserNotifier = (...args) => notifyUser(...args);

/** agent_events row: tool, pane and host only, never typed text or eval code */
export function logAction(
  db: Database.Database,
  ctx: BrowserToolContext,
  entry: { tool: string; paneId: string | null; host: string | null; outcome: string },
): void {
  try {
    db.prepare("INSERT INTO agent_events (agent_id, type, payload) VALUES (?, ?, ?)").run(
      ctx.agentId,
      "browser_action",
      JSON.stringify(entry),
    );
  } catch {
    /* audit is best-effort */
  }
}

export function allowedHostsOf(db: Database.Database, projectId: string): string[] {
  return getProject(db, projectId)?.browserHosts ?? [];
}

export function aliasOf(db: Database.Database, agentId: string): string | null {
  try {
    return getAgent(db, agentId)?.alias ?? null;
  } catch {
    return null;
  }
}

/** The pane an agent means: the one it named, else the last it used, else the only one.
 *  `lenient` (browser_open): with several and none used yet, the first; with none, null */
export function resolvePane(
  panes: BrowserPaneHandle[],
  ctx: BrowserToolContext,
  requested: unknown,
  opts: { lenient: true },
): BrowserPaneHandle | null;
export function resolvePane(
  panes: BrowserPaneHandle[],
  ctx: BrowserToolContext,
  requested: unknown,
): BrowserPaneHandle;
export function resolvePane(
  panes: BrowserPaneHandle[],
  ctx: BrowserToolContext,
  requested: unknown,
  opts: { lenient?: boolean } = {},
): BrowserPaneHandle | null {
  const own = panes.filter((p) => p.projectId === ctx.projectId);
  if (typeof requested === "string" && requested) {
    const p = own.find((x) => x.paneId === requested);
    // Same answer whether the id exists elsewhere or not: nothing to learn about other projects
    if (!p) {
      throw new ExegolToolError(
        `No live browser pane "${requested.slice(0, 64)}" in your project. Call browser_list.`,
        -32602,
      );
    }
    return p;
  }
  const last = lastPaneOf(
    ctx.agentId,
    own.map((p) => p.paneId),
  );
  const pick =
    own.find((p) => p.paneId === last) ??
    (own.length === 1 || opts.lenient ? own[0] : undefined) ??
    null;
  if (pick || opts.lenient) return pick;
  if (own.length === 0) {
    throw new ExegolToolError(
      "No browser pane is open in your project (or its project is not on screen). Call browser_open.",
      -32020,
    );
  }
  throw new ExegolToolError(
    `Several browser panes are open (${own.map((p) => p.paneId).join(", ")}): pass pane.`,
    -32602,
  );
}

export function userHasControl(pane: BrowserPaneHandle) {
  return getPaneControl(pane.paneId)?.userHasControl
    ? {
        status: "user_has_control",
        pane: pane.paneId,
        hint: "The user took over this browser. Wait with browser_wait_for_user, or ask them in chat; tools work again once they hand it back.",
      }
    : null;
}

export function needsUserResult(pane: BrowserPaneHandle, n: NeedsUser) {
  // The same words the user sees on the banner and the alert
  const ask = needsUserReason({
    waitingReason: null,
    needsUserHost: n.host,
    needsUserKind: n.reason,
  });
  return {
    status: "needs_user",
    pane: pane.paneId,
    host: n.host,
    reason: n.reason,
    message: `The page needs the user: ${n.message}.`,
    hint:
      n.reason === "login"
        ? `This is a login page at ${n.host}. Do not type credentials. Call browser_wait_for_user with reason "${ask}"; the user logs in and hands the browser back.`
        : `Do not solve it yourself. Call browser_wait_for_user with reason "${ask}"; Exegol asks the user and resumes you when they hand the browser back.`,
  };
}

interface Inspected<T> {
  /** null when the page is outside the allowed hosts: nothing of it reaches the agent */
  page: T | null;
  /** host:port the page was on when read, for the in-page guard of what follows */
  host: string;
  needsUser: NeedsUser | null;
}

/** Reads the page the pane is on (the small signals, or the full snapshot) and checks it against
 *  the project's hosts. Flags the pane when it needs the user; the renderer raises the alert */
export async function inspect(
  db: Database.Database,
  ctx: BrowserToolContext,
  pane: BrowserPaneHandle,
  full: true,
): Promise<Inspected<RawSnapshot>>;
export async function inspect(
  db: Database.Database,
  ctx: BrowserToolContext,
  pane: BrowserPaneHandle,
  full?: false,
): Promise<Inspected<RawSignals>>;
export async function inspect(
  db: Database.Database,
  ctx: BrowserToolContext,
  pane: BrowserPaneHandle,
  full = false,
): Promise<Inspected<RawSignals>> {
  const allowed = allowedHostsOf(db, ctx.projectId);
  const flag = (n: NeedsUser | null) =>
    setNeedsUser(pane.paneId, ctx.projectId, n ? { host: n.host, kind: n.reason } : null);
  const url = pane.getUrl();
  if (isOutsideAllowlist(url, allowed)) {
    const n = detectNeedsUser({ url, hasCaptcha: false, hasPasswordField: false }, allowed);
    flag(n);
    return { page: null, host: "", needsUser: n };
  }
  const raw = (await pane.runIsolated(full ? snapshotScript() : signalsScript())) as
    | RawSignals
    | RawSnapshot
    | null;
  if (!raw || typeof raw !== "object" || typeof raw.url !== "string") {
    throw new ExegolToolError("Could not read the page (still loading?)", -32021);
  }
  const n = detectNeedsUser({ ...raw, httpStatus: pane.lastHttpStatus() }, allowed);
  flag(n);
  let pageHost = "";
  try {
    pageHost = new URL(raw.url).host;
  } catch {
    /* about:blank and the like: the guard compares "" */
  }
  return { page: n?.reason === "outside_allowlist" ? null : raw, host: pageHost, needsUser: n };
}

export function touch(db: Database.Database, ctx: BrowserToolContext, pane: BrowserPaneHandle) {
  noteAgentAction(pane.paneId, ctx.projectId, { id: ctx.agentId, alias: aliasOf(db, ctx.agentId) });
}

export function checkUrlArg(db: Database.Database, ctx: BrowserToolContext, raw: unknown): string {
  if (typeof raw !== "string" || !raw.trim()) {
    throw new ExegolToolError("url is required", -32602);
  }
  const check = checkAgentUrl(raw, allowedHostsOf(db, ctx.projectId));
  if (!check.ok) throw new ExegolToolError(check.reason, -32022);
  return check.url;
}
