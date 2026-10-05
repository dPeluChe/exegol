import { mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { checkAgentUrl, isHostAllowed } from "@exegol/shared";
import type Database from "libsql";
import { getAgent } from "../db/queries/agents";
import { getProject } from "../db/queries/projects";
import { logger } from "../lib/logger";
import {
  clearWaiting,
  getPaneControl,
  lastPaneOf,
  noteAgentAction,
  setNeedsUser,
  startWaiting,
  waitForHandBack,
} from "./control";
import { isLogLevel, type LogRing } from "./log-ring";
import { detectNeedsUser, type NeedsUser } from "./needs-user";
import {
  actionScript,
  formatSnapshot,
  type PageAction,
  parseKey,
  parseRef,
  type RawSnapshot,
  snapshotScript,
} from "./page-scripts";

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

export class BrowserToolError extends Error {
  constructor(
    message: string,
    public code: number,
  ) {
    super(message);
  }
}

export const BROWSER_READ_TOOLS = [
  "browser_list",
  "browser_open",
  "browser_snapshot",
  "browser_screenshot",
  "browser_logs",
  "browser_wait_for_user",
] as const;
export const BROWSER_WRITE_TOOLS = [
  "browser_navigate",
  "browser_click",
  "browser_type",
  "browser_press",
  "browser_select",
  "browser_eval",
] as const;
export type BrowserToolName =
  | (typeof BROWSER_READ_TOOLS)[number]
  | (typeof BROWSER_WRITE_TOOLS)[number];

let host: BrowserHost | null = null;
export function setBrowserHost(h: BrowserHost | null): void {
  host = h;
}

export type BrowserActionLogger = (
  db: Database.Database,
  ctx: BrowserToolContext,
  entry: { tool: string; paneId: string | null; host: string | null; outcome: string },
) => void;

/** agent_events row: tool, pane and host only, never typed text or eval code */
const defaultLogAction: BrowserActionLogger = (db, ctx, entry) => {
  try {
    db.prepare("INSERT INTO agent_events (agent_id, type, payload) VALUES (?, ?, ?)").run(
      ctx.agentId,
      "browser_action",
      JSON.stringify(entry),
    );
  } catch {
    /* audit is best-effort */
  }
};
let logAction: BrowserActionLogger = defaultLogAction;
export function setBrowserActionLogger(fn: BrowserActionLogger | null): void {
  logAction = fn ?? defaultLogAction;
}

type NeedsUserNotifier = (
  ctx: BrowserToolContext,
  alias: string | null,
  paneId: string,
  what: string,
) => void;
let notifyNeedsUser: NeedsUserNotifier = () => {};
export function setNeedsUserNotifier(fn: NeedsUserNotifier): void {
  notifyNeedsUser = fn;
}

const WAIT_POLL_MS = 25_000;
const DEFAULT_WAIT_MIN = 10;
const MAX_WAIT_MIN = 30;
const LOAD_SETTLE_MS = 400;
const EVAL_TIMEOUT_MS = 10_000;
const MAX_EVAL_RESULT = 20_000;
const MAX_TYPE_CHARS = 5_000;
const MAX_INLINE_IMAGE_BYTES = 1_500_000;
export const SCREENSHOTS_DIR = join(homedir(), ".exegol", "screenshots");

/** Open waits by agent: the hand-back count when each started, so one that landed between two
 *  polls still counts */
const waits = new Map<string, { paneId: string; handBacks: number; deadline: number }>();

function requireHost(): BrowserHost {
  if (!host) throw new BrowserToolError("The browser is not available (no Exegol window)", -32603);
  return host;
}

function allowedHostsOf(db: Database.Database, projectId: string): string[] {
  return getProject(db, projectId)?.browserHosts ?? [];
}

function aliasOf(db: Database.Database, agentId: string): string | null {
  try {
    return getAgent(db, agentId)?.alias ?? null;
  } catch {
    return null;
  }
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname || null;
  } catch {
    return null;
  }
}

/** The pane an agent means: the one it named, else the last it used, else the only one */
export function resolvePane(
  panes: BrowserPaneHandle[],
  ctx: BrowserToolContext,
  requested: unknown,
): BrowserPaneHandle {
  if (typeof requested === "string" && requested) {
    const p = panes.find((x) => x.paneId === requested && x.projectId === ctx.projectId);
    // Same answer whether the id exists elsewhere or not: nothing to learn about other projects
    if (!p) {
      throw new BrowserToolError(
        `No live browser pane "${requested.slice(0, 64)}" in your project. Call browser_list.`,
        -32602,
      );
    }
    return p;
  }
  const own = panes.filter((p) => p.projectId === ctx.projectId);
  if (own.length === 0) {
    throw new BrowserToolError(
      "No browser pane is open in your project (or its project is not on screen). Call browser_open.",
      -32020,
    );
  }
  const last = lastPaneOf(
    ctx.agentId,
    own.map((p) => p.paneId),
  );
  const pick = own.find((p) => p.paneId === last) ?? (own.length === 1 ? own[0] : undefined);
  if (!pick) {
    throw new BrowserToolError(
      `Several browser panes are open (${own.map((p) => p.paneId).join(", ")}): pass pane.`,
      -32602,
    );
  }
  return pick;
}

function userHasControl(pane: BrowserPaneHandle) {
  return getPaneControl(pane.paneId)?.userHasControl
    ? {
        status: "user_has_control",
        pane: pane.paneId,
        hint: "The user took over this browser. Wait with browser_wait_for_user, or ask them in chat; tools work again once they hand it back.",
      }
    : null;
}

async function takeSnapshot(pane: BrowserPaneHandle): Promise<RawSnapshot> {
  const raw = (await pane.runIsolated(snapshotScript())) as RawSnapshot | null;
  if (!raw || typeof raw !== "object") {
    throw new BrowserToolError("Could not read the page (still loading?)", -32021);
  }
  return raw;
}

function needsUserResult(pane: BrowserPaneHandle, n: NeedsUser) {
  return {
    status: "needs_user",
    pane: pane.paneId,
    host: n.host,
    reason: n.reason,
    message: `The page needs the user: ${n.message}.`,
    hint: "Do not type passwords or solve it yourself. Call browser_wait_for_user with a short reason; Exegol asks the user and resumes you when they hand the browser back.",
  };
}

/** Flags the pane and tells the user once per host */
function raiseNeedsUser(
  db: Database.Database,
  ctx: BrowserToolContext,
  pane: BrowserPaneHandle,
  n: NeedsUser,
): void {
  const before = getPaneControl(pane.paneId)?.needsUserHost;
  setNeedsUser(pane.paneId, ctx.projectId, n.host);
  if (before !== n.host) {
    const alias = aliasOf(db, ctx.agentId);
    notifyNeedsUser(
      ctx,
      alias,
      pane.paneId,
      n.reason === "login" || n.reason === "sso" || n.reason.startsWith("http_")
        ? `log in at ${n.host}`
        : n.message,
    );
  }
}

/** The page the pane is on, checked against the project's hosts: content outside them never
 *  reaches the agent */
async function inspect(
  db: Database.Database,
  ctx: BrowserToolContext,
  pane: BrowserPaneHandle,
): Promise<{ raw: RawSnapshot | null; needsUser: NeedsUser | null }> {
  const allowed = allowedHostsOf(db, ctx.projectId);
  const url = pane.getUrl();
  const h = hostOf(url);
  if (h && /^https?:/.test(url) && !isHostAllowed(h, allowed)) {
    const n = detectNeedsUser({ url, hasCaptcha: false, hasPasswordField: false }, allowed);
    if (n) raiseNeedsUser(db, ctx, pane, n);
    return { raw: null, needsUser: n };
  }
  const raw = await takeSnapshot(pane);
  const n = detectNeedsUser(
    {
      url: raw.url,
      httpStatus: pane.lastHttpStatus(),
      hasPasswordField: raw.hasPasswordField,
      hasCaptcha: raw.hasCaptcha,
    },
    allowed,
  );
  if (n) raiseNeedsUser(db, ctx, pane, n);
  else if (getPaneControl(pane.paneId)?.needsUserHost) {
    setNeedsUser(pane.paneId, ctx.projectId, null);
  }
  return { raw: n?.reason === "outside_allowlist" ? null : raw, needsUser: n };
}

const settle = () => new Promise((r) => setTimeout(r, LOAD_SETTLE_MS));

async function pageSummary(
  db: Database.Database,
  ctx: BrowserToolContext,
  pane: BrowserPaneHandle,
) {
  const { raw, needsUser } = await inspect(db, ctx, pane);
  if (needsUser) return needsUserResult(pane, needsUser);
  return { status: "ok", pane: pane.paneId, url: raw?.url, title: raw?.title };
}

function touch(db: Database.Database, ctx: BrowserToolContext, pane: BrowserPaneHandle): void {
  noteAgentAction(pane.paneId, ctx.projectId, { id: ctx.agentId, alias: aliasOf(db, ctx.agentId) });
}

function checkUrlArg(db: Database.Database, ctx: BrowserToolContext, raw: unknown): string {
  if (typeof raw !== "string" || !raw.trim()) {
    throw new BrowserToolError("url is required", -32602);
  }
  const check = checkAgentUrl(raw, allowedHostsOf(db, ctx.projectId));
  if (!check.ok) throw new BrowserToolError(check.reason, -32022);
  return check.url;
}

async function handleList(db: Database.Database, ctx: BrowserToolContext) {
  const allowed = allowedHostsOf(db, ctx.projectId);
  const panes = requireHost().livePanes(ctx.projectId);
  return {
    panes: panes.map((p) => {
      const url = p.getUrl();
      const h = hostOf(url);
      const visible = !h || !/^https?:/.test(url) || isHostAllowed(h, allowed);
      const c = getPaneControl(p.paneId);
      return {
        pane: p.paneId,
        url: visible ? url : `(outside the allowed hosts: ${h})`,
        title: visible ? p.getTitle() : null,
        controlledBy: c?.userHasControl
          ? "user"
          : c?.agentId === ctx.agentId
            ? "you"
            : c?.agentId
              ? (c.alias ?? c.agentId)
              : null,
        waitingForUser: !!c?.waiting,
      };
    }),
    allowedHosts: ["localhost", "127.0.0.1", "[::1]", "*.localhost", "*.local", ...allowed],
    ...(panes.length === 0
      ? { hint: 'No pane is live: browser_open opens one (url, or "dev" for the dev server).' }
      : {}),
  };
}

async function handleOpen(
  db: Database.Database,
  ctx: BrowserToolContext,
  args: Record<string, unknown>,
) {
  const h = requireHost();
  let target = args.url;
  if (target === "dev" || target === undefined) {
    const dev = await h.devServerUrl(ctx.projectId);
    if (!dev) {
      throw new BrowserToolError(
        "No dev server is running for this project. Start it, or pass url.",
        -32023,
      );
    }
    target = dev;
  }
  const url = checkUrlArg(db, ctx, target);
  const panes = h.livePanes(ctx.projectId);
  let pane: BrowserPaneHandle | null = null;
  if (args.new_pane !== true && panes.length > 0) {
    pane = resolvePaneLenient(panes, ctx, args.pane);
  }
  if (pane) {
    const blocked = userHasControl(pane);
    if (blocked) return blocked;
    await pane.loadUrl(url);
  } else {
    pane = await h.openPane({ projectId: ctx.projectId, agentId: ctx.agentId, url });
  }
  touch(db, ctx, pane);
  await settle();
  const result = await pageSummary(db, ctx, pane);
  logAction(db, ctx, {
    tool: "browser_open",
    paneId: pane.paneId,
    host: hostOf(url),
    outcome: result.status,
  });
  return result;
}

/** browser_open reuses a pane: a named one, the agent's last, else the first */
function resolvePaneLenient(
  panes: BrowserPaneHandle[],
  ctx: BrowserToolContext,
  requested: unknown,
) {
  if (typeof requested === "string" && requested) return resolvePane(panes, ctx, requested);
  const own = panes.filter((p) => p.projectId === ctx.projectId);
  const last = lastPaneOf(
    ctx.agentId,
    own.map((p) => p.paneId),
  );
  return own.find((p) => p.paneId === last) ?? own[0] ?? null;
}

async function handleSnapshot(
  db: Database.Database,
  ctx: BrowserToolContext,
  pane: BrowserPaneHandle,
) {
  const { raw, needsUser } = await inspect(db, ctx, pane);
  touch(db, ctx, pane);
  if (!raw) return needsUserResult(pane, needsUser as NeedsUser);
  const snap = formatSnapshot(raw);
  return {
    pane: pane.paneId,
    ...snap,
    ...(needsUser ? { needs_user: needsUserResult(pane, needsUser) } : {}),
    hint: "Act on elements by ref (e12) with browser_click / browser_type / browser_select. Refs stay valid on this page until it navigates.",
  };
}

async function handleScreenshot(
  db: Database.Database,
  ctx: BrowserToolContext,
  pane: BrowserPaneHandle,
  images: boolean,
) {
  const { needsUser, raw } = await inspect(db, ctx, pane);
  if (!raw && needsUser) return needsUserResult(pane, needsUser);
  touch(db, ctx, pane);
  const png = await pane.capture();
  mkdirSync(SCREENSHOTS_DIR, { recursive: true, mode: 0o700 });
  const path = join(SCREENSHOTS_DIR, `${ctx.agentId}-${Date.now()}.png`);
  writeFileSync(path, png, { mode: 0o600 });
  const info = { pane: pane.paneId, url: pane.getUrl(), path, bytes: png.length };
  if (images && png.length <= MAX_INLINE_IMAGE_BYTES) {
    return {
      __mcpContent: [
        { type: "image", data: png.toString("base64"), mimeType: "image/png" },
        { type: "text", text: JSON.stringify(info) },
      ],
    };
  }
  return { ...info, hint: "Read the PNG at path to see it." };
}

function handleLogs(
  pane: BrowserPaneHandle,
  args: Record<string, unknown>,
  allowed: readonly string[],
) {
  const since = Number.isFinite(Number(args.since)) ? Math.max(0, Number(args.since)) : undefined;
  const level = isLogLevel(args.level) ? args.level : undefined;
  const limit = Number.isFinite(Number(args.limit)) ? Number(args.limit) : undefined;
  const r = pane.logs.query({ since, level, limit });
  return {
    pane: pane.paneId,
    entries: r.entries
      .filter((e) => !e.page || isHostAllowed(e.page, allowed))
      .map(({ page: _page, ...e }) => e),
    lastSeq: r.lastSeq,
    ...(r.dropped ? { note: "Older entries were dropped (the buffer keeps the last 500)." } : {}),
    hint: "Pass since: lastSeq next time to get only newer entries.",
  };
}

async function handleWait(
  db: Database.Database,
  ctx: BrowserToolContext,
  args: Record<string, unknown>,
) {
  const reason = String(args.reason ?? "")
    .trim()
    .slice(0, 300);
  if (!reason) throw new BrowserToolError("reason is required: tell the user what to do", -32602);
  const minutes = Math.min(
    Math.max(Number(args.timeout_minutes) || DEFAULT_WAIT_MIN, 1),
    MAX_WAIT_MIN,
  );
  const pane = resolvePane(requireHost().livePanes(ctx.projectId), ctx, args.pane);
  const alias = aliasOf(db, ctx.agentId);
  const handBacks = () => getPaneControl(pane.paneId)?.handBacks ?? 0;

  let wait = waits.get(ctx.agentId);
  if (wait && wait.paneId !== pane.paneId) {
    clearWaiting(wait.paneId);
    wait = undefined;
  }
  if (!wait) {
    wait = { paneId: pane.paneId, handBacks: handBacks(), deadline: Date.now() + minutes * 60_000 };
    waits.set(ctx.agentId, wait);
    startWaiting(pane.paneId, ctx.projectId, { id: ctx.agentId, alias }, reason, wait.deadline);
    notifyNeedsUser(ctx, alias, pane.paneId, reason);
    logAction(db, ctx, {
      tool: "browser_wait_for_user",
      paneId: pane.paneId,
      host: hostOf(pane.getUrl()),
      outcome: "started",
    });
  }
  const current = wait;
  const handedBack = async () => {
    waits.delete(ctx.agentId);
    await settle();
    const summary = await pageSummary(db, ctx, pane).catch(() => ({ status: "ok" }));
    return {
      ...summary,
      status: "handed_back",
      hint: "The user handed the browser back. Call browser_snapshot to see what changed.",
    };
  };
  if (handBacks() > current.handBacks) return handedBack();
  const left = current.deadline - Date.now();
  if (left <= 0) {
    waits.delete(ctx.agentId);
    clearWaiting(pane.paneId);
    return {
      status: "timed_out",
      pane: pane.paneId,
      hint: "The user did not hand the browser back in time. Tell them in chat what you need, then stop or try again later.",
    };
  }
  const woke = await waitForHandBack(pane.paneId, Math.min(WAIT_POLL_MS, left));
  if (woke || handBacks() > current.handBacks) return handedBack();
  return {
    status: "waiting",
    pane: pane.paneId,
    remainingSeconds: Math.round((current.deadline - Date.now()) / 1000),
    hint: "Still waiting for the user. Call browser_wait_for_user again with the same reason.",
  };
}

async function handleNavigate(
  db: Database.Database,
  ctx: BrowserToolContext,
  pane: BrowserPaneHandle,
  args: Record<string, unknown>,
) {
  const url = checkUrlArg(db, ctx, args.url);
  touch(db, ctx, pane);
  await pane.loadUrl(url);
  await settle();
  return pageSummary(db, ctx, pane);
}

async function runAction(
  db: Database.Database,
  ctx: BrowserToolContext,
  pane: BrowserPaneHandle,
  refArg: unknown,
  act: PageAction,
) {
  const ref = parseRef(refArg);
  if (!ref) throw new BrowserToolError("ref must look like e12 (from browser_snapshot)", -32602);
  const { raw, needsUser } = await inspect(db, ctx, pane);
  if (!raw) return needsUserResult(pane, needsUser as NeedsUser);
  touch(db, ctx, pane);
  const r = (await pane.runIsolated(actionScript(ref, act))) as {
    ok?: boolean;
    error?: string;
    options?: string[];
    value?: string;
  } | null;
  if (r?.error === "password") {
    throw new BrowserToolError(
      "Refused: that is a password field. Agents never type passwords: call browser_wait_for_user and let the user log in.",
      -32024,
    );
  }
  if (r?.error === "stale_ref") {
    throw new BrowserToolError(
      `${ref} is not on the page anymore: take a new browser_snapshot`,
      -32025,
    );
  }
  if (!r?.ok) {
    throw new BrowserToolError(
      `${act.action} failed on ${ref}: ${r?.error ?? "no result"}${r?.options ? ` (options: ${r.options.join(", ")})` : ""}`,
      -32026,
    );
  }
  await settle();
  return pageSummary(db, ctx, pane);
}

async function handlePress(
  db: Database.Database,
  ctx: BrowserToolContext,
  pane: BrowserPaneHandle,
  args: Record<string, unknown>,
) {
  const key = parseKey(args.key);
  if (!key) {
    throw new BrowserToolError(
      "key must be a single key or named key with optional modifiers: a, Enter, Tab, Escape, ArrowDown, Shift+Tab, Control+a",
      -32602,
    );
  }
  const { raw, needsUser } = await inspect(db, ctx, pane);
  if (!raw) return needsUserResult(pane, needsUser as NeedsUser);
  const focus = (await pane.runIsolated(actionScript(null, { action: "check-focus" }))) as {
    secret?: boolean;
  } | null;
  if (focus?.secret) {
    throw new BrowserToolError(
      "Refused: a password field has the focus. Agents never type passwords.",
      -32024,
    );
  }
  touch(db, ctx, pane);
  pane.sendKey(key.keyCode, key.modifiers);
  await settle();
  return pageSummary(db, ctx, pane);
}

async function handleEval(
  db: Database.Database,
  ctx: BrowserToolContext,
  pane: BrowserPaneHandle,
  args: Record<string, unknown>,
) {
  const code =
    typeof args.js === "string" ? args.js : typeof args.code === "string" ? args.code : "";
  if (!code.trim()) throw new BrowserToolError("js is required", -32602);
  if (code.length > 20_000) throw new BrowserToolError("js too long (max 20000)", -32602);
  const { raw, needsUser } = await inspect(db, ctx, pane);
  if (!raw) return needsUserResult(pane, needsUser as NeedsUser);
  touch(db, ctx, pane);
  let value: unknown;
  try {
    value = await pane.runMain(code, EVAL_TIMEOUT_MS);
  } catch (err) {
    return {
      status: "error",
      error: err instanceof Error ? err.message.slice(0, 2_000) : String(err),
    };
  }
  let text: string;
  try {
    text = JSON.stringify(value) ?? "undefined";
  } catch {
    text = String(value);
  }
  return {
    status: "ok",
    result: text.length > MAX_EVAL_RESULT ? `${text.slice(0, MAX_EVAL_RESULT)}…` : text,
  };
}

export const isBrowserTool = (tool: string): tool is BrowserToolName =>
  (BROWSER_READ_TOOLS as readonly string[]).includes(tool) ||
  (BROWSER_WRITE_TOOLS as readonly string[]).includes(tool);

/** Dispatch one browser tool. Access mode and project come from the caller's token (server side) */
export async function callBrowserTool(
  db: Database.Database,
  tool: BrowserToolName,
  args: Record<string, unknown>,
  ctx: BrowserToolContext,
  opts: { images?: boolean } = {},
): Promise<unknown> {
  if ((BROWSER_WRITE_TOOLS as readonly string[]).includes(tool) && ctx.accessMode !== "write") {
    throw new BrowserToolError(
      `Tool "${tool}" requires write access (agent is in "${ctx.accessMode}" mode)`,
      -32001,
    );
  }
  if (tool === "browser_list") return handleList(db, ctx);
  if (tool === "browser_open") return handleOpen(db, ctx, args);
  if (tool === "browser_wait_for_user") return handleWait(db, ctx, args);

  const pane = resolvePane(requireHost().livePanes(ctx.projectId), ctx, args.pane);
  const blocked = userHasControl(pane);
  if (blocked) return blocked;
  let result: unknown;
  try {
    switch (tool) {
      case "browser_snapshot":
        result = await handleSnapshot(db, ctx, pane);
        break;
      case "browser_screenshot":
        result = await handleScreenshot(db, ctx, pane, opts.images === true);
        break;
      case "browser_logs": {
        // A page outside the allowed hosts keeps its console and requests to itself
        const h = hostOf(pane.getUrl());
        if (
          h &&
          /^https?:/.test(pane.getUrl()) &&
          !isHostAllowed(h, allowedHostsOf(db, ctx.projectId))
        ) {
          const n = detectNeedsUser(
            { url: pane.getUrl(), hasCaptcha: false, hasPasswordField: false },
            [],
          );
          if (n) {
            result = needsUserResult(pane, n);
            break;
          }
        }
        touch(db, ctx, pane);
        result = handleLogs(pane, args, allowedHostsOf(db, ctx.projectId));
        break;
      }
      case "browser_navigate":
        result = await handleNavigate(db, ctx, pane, args);
        break;
      case "browser_click":
        result = await runAction(db, ctx, pane, args.ref, { action: "click" });
        break;
      case "browser_type": {
        const text = typeof args.text === "string" ? args.text : "";
        if (text.length > MAX_TYPE_CHARS) {
          throw new BrowserToolError(`text too long (max ${MAX_TYPE_CHARS})`, -32602);
        }
        result = await runAction(db, ctx, pane, args.ref, {
          action: "type",
          text,
          submit: args.submit === true,
          append: args.append === true,
        });
        break;
      }
      case "browser_press":
        result = await handlePress(db, ctx, pane, args);
        break;
      case "browser_select":
        result = await runAction(db, ctx, pane, args.ref, {
          action: "select",
          value: String(args.value ?? ""),
        });
        break;
      case "browser_eval":
        result = await handleEval(db, ctx, pane, args);
        break;
    }
  } catch (err) {
    logAction(db, ctx, {
      tool,
      paneId: pane.paneId,
      host: hostOf(pane.getUrl()),
      outcome: "error",
    });
    if (!(err instanceof BrowserToolError)) logger.warn(`[AgentBrowser] ${tool} failed:`, err);
    throw err;
  }
  if (tool !== "browser_logs" && tool !== "browser_snapshot") {
    const status = (result as { status?: string } | null)?.status ?? "ok";
    logAction(db, ctx, { tool, paneId: pane.paneId, host: hostOf(pane.getUrl()), outcome: status });
  }
  return result;
}

/** Tests only */
export function resetBrowserWaits(): void {
  waits.clear();
}
