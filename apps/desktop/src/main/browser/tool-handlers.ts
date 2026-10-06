import { chmodSync, mkdirSync, readdirSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { hostOf, isHostAllowed, isOutsideAllowlist, LOCAL_HOST_PATTERNS } from "@exegol/shared";
import type Database from "libsql";
import { getProject } from "../db/queries/projects";
import { ExegolToolError } from "../mcp/exegol-protocol";
import {
  clearWaiting,
  getPaneControl,
  startWaiting,
  type WakeReason,
  waitForHandBack,
} from "./control";
import { isLogLevel } from "./log-ring";
import {
  actionScript,
  formatSnapshot,
  guardedEvalScript,
  isPageChangedError,
  type PageAction,
  parseKey,
  parseRef,
} from "./page-scripts";
import {
  aliasOf,
  allowedHostsOf,
  type BrowserPaneHandle,
  type BrowserToolContext,
  checkUrlArg,
  inspect,
  logAction,
  needsUserResult,
  notifyNeedsUser,
  requireHost,
  resolvePane,
  touch,
  userHasControl,
} from "./tool-guards";

const WAIT_POLL_MS = 25_000;
/** A wait not polled for this long was abandoned (the agent moved on): the next call starts over */
const WAIT_STALE_MS = 30_000;
const DEFAULT_WAIT_MIN = 10;
const MAX_WAIT_MIN = 30;
const LOAD_SETTLE_MS = 400;
const EVAL_TIMEOUT_MS = 10_000;
const MAX_EVAL_RESULT = 20_000;
const MAX_INLINE_IMAGE_BYTES = 1_500_000;
const SCREENSHOTS_DIR = join(homedir(), ".exegol", "screenshots");
const SCREENSHOT_MAX_AGE_MS = 24 * 60 * 60_000;
const SCREENSHOTS_KEPT = 50;

const PAGE_CHANGED =
  "The page changed (navigated to another host) before the action ran: take a new browser_snapshot.";

interface OpenWait {
  paneId: string;
  reason: string;
  handBacks: number;
  deadline: number;
  lastPollAt: number;
}

/** Open waits by agent: the hand-back count when each started, so one that landed between two
 *  polls still counts */
const waits = new Map<string, OpenWait>();

/** A wait call continues the open one only when it is the same ask, still in time and still
 *  being polled; anything else starts a fresh wait (and a fresh alert) */
export function isWaitStale(
  wait: OpenWait | undefined,
  call: { paneId: string; reason: string; now: number },
): boolean {
  return (
    !wait ||
    wait.paneId !== call.paneId ||
    wait.reason !== call.reason ||
    call.now >= wait.deadline ||
    call.now - wait.lastPollAt > WAIT_STALE_MS
  );
}

export function clearAgentWaits(agentId: string): void {
  const wait = waits.get(agentId);
  if (!wait) return;
  waits.delete(agentId);
  clearWaiting(wait.paneId);
}

const settle = () => new Promise((r) => setTimeout(r, LOAD_SETTLE_MS));

/** Where the pane is after an action: the url, and the page's title as page data */
async function pageSummary(
  db: Database.Database,
  ctx: BrowserToolContext,
  pane: BrowserPaneHandle,
) {
  const { page, needsUser } = await inspect(db, ctx, pane);
  if (needsUser) return needsUserResult(pane, needsUser);
  return {
    status: "ok",
    pane: pane.paneId,
    url: page?.url,
    untrusted_page_content: { title: page?.title.slice(0, 300) ?? "" },
  };
}

export async function handleList(db: Database.Database, ctx: BrowserToolContext) {
  const allowed = allowedHostsOf(db, ctx.projectId);
  const panes = requireHost().livePanes(ctx.projectId);
  return {
    panes: panes.map((p) => {
      const url = p.getUrl();
      const visible = !isOutsideAllowlist(url, allowed);
      const c = getPaneControl(p.paneId);
      return {
        pane: p.paneId,
        url: visible ? url : `(outside the allowed hosts: ${hostOf(url)})`,
        untrusted_page_content: { title: visible ? p.getTitle().slice(0, 300) : null },
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
    allowedHosts: [...LOCAL_HOST_PATTERNS, ...allowed],
    ...(panes.length === 0
      ? { hint: 'No pane is live: browser_open opens one (url, or "dev" for the dev server).' }
      : {}),
  };
}

export async function handleOpen(
  db: Database.Database,
  ctx: BrowserToolContext,
  args: Record<string, unknown>,
) {
  const h = requireHost();
  const readOnly = ctx.accessMode !== "write";
  if (readOnly && typeof args.pane === "string" && args.pane) {
    throw new ExegolToolError(
      `In "${ctx.accessMode}" mode browser_open only opens a new pane; it never navigates one. Omit pane.`,
      -32001,
    );
  }
  let target = args.url;
  if (target === "dev" || target === undefined) {
    const dev = await h.devServerUrl(ctx.projectId);
    if (!dev) {
      throw new ExegolToolError(
        "No dev server is running for this project. Start it, or pass url.",
        -32023,
      );
    }
    target = dev;
  }
  const url = checkUrlArg(db, ctx, target);
  const reuse =
    readOnly || args.new_pane === true
      ? null
      : resolvePane(h.livePanes(ctx.projectId), ctx, args.pane, { lenient: true });
  let pane: BrowserPaneHandle;
  if (reuse) {
    const blocked = userHasControl(reuse);
    if (blocked) return blocked;
    pane = reuse;
    touch(db, ctx, pane);
    await pane.loadUrl(url);
  } else {
    pane = await h.openPane({ projectId: ctx.projectId, agentId: ctx.agentId, url });
    touch(db, ctx, pane);
  }
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

export async function handleSnapshot(
  db: Database.Database,
  ctx: BrowserToolContext,
  pane: BrowserPaneHandle,
) {
  const { page, needsUser } = await inspect(db, ctx, pane, true);
  touch(db, ctx, pane);
  if (!page) {
    if (needsUser) return needsUserResult(pane, needsUser);
    throw new ExegolToolError("Could not read the page", -32021);
  }
  const { truncated, ...content } = formatSnapshot(page);
  return {
    pane: pane.paneId,
    url: page.url,
    untrusted_page_content: content,
    truncated,
    ...(needsUser ? { needs_user: needsUserResult(pane, needsUser) } : {}),
    hint: "Act on elements by ref (e12.k3x) with browser_click / browser_type / browser_select. A ref works only on the page it came from: after a navigation, take a new snapshot.",
  };
}

/** The last day's screenshots, at most SCREENSHOTS_KEPT of them */
function pruneScreenshots(now: number): void {
  try {
    const files = readdirSync(SCREENSHOTS_DIR)
      .map((name) => {
        const path = join(SCREENSHOTS_DIR, name);
        return { path, mtime: statSync(path).mtimeMs };
      })
      .sort((a, b) => b.mtime - a.mtime);
    files.forEach((f, i) => {
      if (i >= SCREENSHOTS_KEPT || now - f.mtime > SCREENSHOT_MAX_AGE_MS) unlinkSync(f.path);
    });
  } catch {
    /* best-effort */
  }
}

export async function handleScreenshot(
  db: Database.Database,
  ctx: BrowserToolContext,
  pane: BrowserPaneHandle,
) {
  const { page, needsUser } = await inspect(db, ctx, pane);
  if (!page) {
    if (needsUser) return needsUserResult(pane, needsUser);
    throw new ExegolToolError("Could not read the page", -32021);
  }
  touch(db, ctx, pane);
  const jpeg = await pane.capture();
  // The page may have left the allowed hosts while it was being captured
  const url = pane.getUrl();
  if (isOutsideAllowlist(url, allowedHostsOf(db, ctx.projectId))) {
    const after = await inspect(db, ctx, pane);
    if (after.needsUser) return needsUserResult(pane, after.needsUser);
    throw new ExegolToolError(PAGE_CHANGED, -32025);
  }
  mkdirSync(SCREENSHOTS_DIR, { recursive: true, mode: 0o700 });
  chmodSync(SCREENSHOTS_DIR, 0o700);
  const now = Date.now();
  pruneScreenshots(now);
  const path = join(SCREENSHOTS_DIR, `${ctx.agentId}-${now}.jpg`);
  writeFileSync(path, jpeg, { mode: 0o600 });
  const info = { pane: pane.paneId, url, path, bytes: jpeg.length };
  if (jpeg.length <= MAX_INLINE_IMAGE_BYTES) {
    return {
      __mcpContent: [
        { type: "image", data: jpeg.toString("base64"), mimeType: "image/jpeg" },
        { type: "text", text: JSON.stringify(info) },
      ],
    };
  }
  return { ...info, hint: "Read the JPEG at path to see it." };
}

export async function handleLogs(
  db: Database.Database,
  ctx: BrowserToolContext,
  pane: BrowserPaneHandle,
  args: Record<string, unknown>,
) {
  const allowed = allowedHostsOf(db, ctx.projectId);
  // A page outside the allowed hosts keeps its console and requests to itself
  if (isOutsideAllowlist(pane.getUrl(), allowed)) {
    const { needsUser } = await inspect(db, ctx, pane);
    if (needsUser) return needsUserResult(pane, needsUser);
  }
  touch(db, ctx, pane);
  const since = Number.isFinite(Number(args.since)) ? Math.max(0, Number(args.since)) : undefined;
  const level = isLogLevel(args.level) ? args.level : undefined;
  const limit = Number.isFinite(Number(args.limit)) ? Number(args.limit) : undefined;
  const r = pane.logs.query({ since, level, limit });
  return {
    pane: pane.paneId,
    untrusted_page_content: {
      entries: r.entries
        .filter((e) => !e.page || isHostAllowed(e.page, allowed))
        .map(({ page: _page, ...e }) => e),
    },
    lastSeq: r.lastSeq,
    ...(r.dropped ? { note: "Older entries were dropped (the buffer keeps the last 500)." } : {}),
    hint: "Pass since: lastSeq next time to get only newer entries.",
  };
}

export async function handleWait(
  db: Database.Database,
  ctx: BrowserToolContext,
  args: Record<string, unknown>,
) {
  const reason = String(args.reason ?? "")
    .trim()
    .slice(0, 300);
  if (!reason) throw new ExegolToolError("reason is required: tell the user what to do", -32602);
  const minutes = Math.min(
    Math.max(Number(args.timeout_minutes) || DEFAULT_WAIT_MIN, 1),
    MAX_WAIT_MIN,
  );
  const pane = resolvePane(requireHost().livePanes(ctx.projectId), ctx, args.pane);
  const handBacks = () => getPaneControl(pane.paneId)?.handBacks ?? 0;
  const now = Date.now();

  let wait = waits.get(ctx.agentId);
  if (isWaitStale(wait, { paneId: pane.paneId, reason, now })) {
    if (wait && wait.paneId !== pane.paneId) clearWaiting(wait.paneId);
    const alias = aliasOf(db, ctx.agentId);
    // The pane already raised "needs you" (a login it stopped at): no second alert
    const alreadyAsked = !!getPaneControl(pane.paneId)?.needsUser;
    wait = {
      paneId: pane.paneId,
      reason,
      handBacks: handBacks(),
      deadline: now + minutes * 60_000,
      lastPollAt: now,
    };
    waits.set(ctx.agentId, wait);
    startWaiting(pane.paneId, ctx.projectId, { id: ctx.agentId, alias }, reason, wait.deadline);
    if (!alreadyAsked) notifyNeedsUser(ctx, alias, reason);
    logAction(db, ctx, {
      tool: "browser_wait_for_user",
      paneId: pane.paneId,
      host: hostOf(pane.getUrl()),
      outcome: "started",
    });
  }
  const current = wait as OpenWait;
  current.lastPollAt = now;
  const done = async (how: WakeReason) => {
    waits.delete(ctx.agentId);
    if (how === "pane_closed") {
      return {
        status: "pane_closed",
        pane: pane.paneId,
        hint: "The browser pane was closed. Open one with browser_open if you still need it.",
      };
    }
    await settle();
    const summary = await pageSummary(db, ctx, pane).catch(() => ({ status: "ok" }));
    return {
      ...summary,
      status: "handed_back",
      hint: "The user handed the browser back. Call browser_snapshot to see what changed.",
    };
  };
  if (handBacks() > current.handBacks) return done("handed_back");
  const left = current.deadline - now;
  const woke = await waitForHandBack(pane.paneId, Math.min(WAIT_POLL_MS, left));
  if (woke !== "timeout") return done(woke);
  if (handBacks() > current.handBacks) return done("handed_back");
  if (Date.now() >= current.deadline) {
    waits.delete(ctx.agentId);
    clearWaiting(pane.paneId);
    return {
      status: "timed_out",
      pane: pane.paneId,
      hint: "The user did not hand the browser back in time. Tell them in chat what you need, then stop or try again later.",
    };
  }
  return {
    status: "waiting",
    pane: pane.paneId,
    remainingSeconds: Math.round((current.deadline - Date.now()) / 1000),
    hint: "Still waiting for the user. Call browser_wait_for_user again with the same reason.",
  };
}

export async function handleNavigate(
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

async function runGuarded<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (err) {
    if (isPageChangedError(err)) throw new ExegolToolError(PAGE_CHANGED, -32025);
    throw err;
  }
}

export async function runAction(
  db: Database.Database,
  ctx: BrowserToolContext,
  pane: BrowserPaneHandle,
  refArg: unknown,
  act: PageAction,
) {
  const ref = parseRef(refArg);
  if (!ref) {
    throw new ExegolToolError("ref must look like e12.k3x (from browser_snapshot)", -32602);
  }
  const { page, host, needsUser } = await inspect(db, ctx, pane);
  if (!page) {
    if (needsUser) return needsUserResult(pane, needsUser);
    throw new ExegolToolError("Could not read the page", -32021);
  }
  touch(db, ctx, pane);
  const r = (await runGuarded(() => pane.runIsolated(actionScript(ref, act, host)))) as {
    ok?: boolean;
    error?: string;
    options?: string[];
    value?: string;
  } | null;
  if (r?.error === "password") {
    throw new ExegolToolError(
      "Refused: that looks like a password field. Agents never type passwords: call browser_wait_for_user and let the user log in.",
      -32024,
    );
  }
  if (r?.error === "stale_ref") {
    throw new ExegolToolError(
      `${ref} is not on the page anymore (it changed or navigated): take a new browser_snapshot`,
      -32025,
    );
  }
  if (!r?.ok) {
    throw new ExegolToolError(
      `${act.action} failed on ${ref}: ${r?.error ?? "no result"}${r?.options ? ` (options: ${r.options.join(", ")})` : ""}`,
      -32026,
    );
  }
  await settle();
  return pageSummary(db, ctx, pane);
}

export async function handlePress(
  db: Database.Database,
  ctx: BrowserToolContext,
  pane: BrowserPaneHandle,
  args: Record<string, unknown>,
) {
  const key = parseKey(args.key);
  if (!key) {
    throw new ExegolToolError(
      "key must be a single key or named key with optional modifiers: a, Enter, Tab, Escape, ArrowDown, Shift+Tab, Control+a",
      -32602,
    );
  }
  const { page, needsUser } = await inspect(db, ctx, pane);
  if (!page) {
    if (needsUser) return needsUserResult(pane, needsUser);
    throw new ExegolToolError("Could not read the page", -32021);
  }
  if (page.focusSecret) {
    throw new ExegolToolError(
      "Refused: a password field has the focus. Agents never type passwords.",
      -32024,
    );
  }
  touch(db, ctx, pane);
  pane.sendKey(key.keyCode, key.modifiers);
  await settle();
  return pageSummary(db, ctx, pane);
}

export async function handleEval(
  db: Database.Database,
  ctx: BrowserToolContext,
  pane: BrowserPaneHandle,
  args: Record<string, unknown>,
) {
  if (!getProject(db, ctx.projectId)?.browserEval) {
    throw new ExegolToolError(
      "browser_eval is off for this project. Use browser_snapshot, click and type, or ask the user to allow it in Edit project > Agent browser.",
      -32029,
    );
  }
  const code =
    typeof args.js === "string" ? args.js : typeof args.code === "string" ? args.code : "";
  if (!code.trim()) throw new ExegolToolError("js is required", -32602);
  if (code.length > 20_000) throw new ExegolToolError("js too long (max 20000)", -32602);
  const { page, host, needsUser } = await inspect(db, ctx, pane);
  if (!page) {
    if (needsUser) return needsUserResult(pane, needsUser);
    throw new ExegolToolError("Could not read the page", -32021);
  }
  touch(db, ctx, pane);
  let value: unknown;
  try {
    value = await runGuarded(() => pane.runMain(guardedEvalScript(code, host), EVAL_TIMEOUT_MS));
  } catch (err) {
    if (err instanceof ExegolToolError) throw err;
    return {
      status: "error",
      untrusted_page_content: {
        error: err instanceof Error ? err.message.slice(0, 2_000) : String(err).slice(0, 2_000),
      },
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
    untrusted_page_content: {
      result: text.length > MAX_EVAL_RESULT ? `${text.slice(0, MAX_EVAL_RESULT)}…` : text,
    },
  };
}
