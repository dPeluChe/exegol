import { hostOf, isOutsideAllowlist, LOCAL_HOST_PATTERNS } from "@exegol/shared";
import type Database from "libsql";
import { getProject } from "../db/queries/projects";
import { delay } from "../lib/timeout";
import { ExegolToolError } from "../mcp/exegol-protocol";
import { getPaneControl } from "./control";
import { isLogLevel } from "./log-ring";
import {
  type ActionResult,
  actionScript,
  type PageAction,
  type ScrollTarget,
  scrollScript,
  waitScript,
} from "./page-actions";
import {
  guardedEvalScript,
  isPageChangedError,
  parseKey,
  parseRef,
  watchScript,
} from "./page-scripts";
import {
  allowedHostsOf,
  type BrowserPaneHandle,
  type BrowserToolContext,
  checkUrlArg,
  type HistoryAction,
  inspect,
  logAction,
  needsUserResult,
  PAGE_CHANGED,
  pageUnavailable,
  requireHost,
  resolvePane,
  touch,
  userHasControl,
  visibleEntries,
} from "./tool-guards";
import { markAction, pageSummary, snapshotView } from "./tool-outcome";

const EVAL_TIMEOUT_MS = 10_000;
const MAX_EVAL_RESULT = 20_000;

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
    pane.loadUrl(url);
  } else {
    pane = await h.openPane({ projectId: ctx.projectId, agentId: ctx.agentId, url });
    touch(db, ctx, pane);
  }
  const result = await pageSummary(db, ctx, pane, markAction(pane, args.snapshot));
  logAction(db, ctx, {
    tool: "browser_open",
    paneId: pane.paneId,
    host: hostOf(url),
    outcome: result.status,
  });
  return result;
}

const count = (raw: unknown): number => {
  const n = Math.floor(Number(raw));
  return Number.isFinite(n) && n > 0 ? n : 0;
};

export async function handleSnapshot(
  db: Database.Database,
  ctx: BrowserToolContext,
  pane: BrowserPaneHandle,
  args: Record<string, unknown>,
) {
  const opts = {
    full: args.full === true,
    offset: count(args.offset),
    textOffset: count(args.text_offset),
  };
  const { page, needsUser, loadFailed } = await inspect(db, ctx, pane, opts);
  touch(db, ctx, pane);
  if (!page) return pageUnavailable(pane, needsUser, loadFailed);
  return snapshotView(pane, page, opts, needsUser);
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
  const since = count(args.since);
  const level = isLogLevel(args.level) ? args.level : undefined;
  const limit = Number.isFinite(Number(args.limit)) ? Number(args.limit) : undefined;
  const r = pane.logs.query({ since, level, limit });
  return {
    pane: pane.paneId,
    untrusted_page_content: {
      entries: visibleEntries(r.entries, allowed).map(({ page: _page, ...e }) => e),
    },
    lastSeq: r.lastSeq,
    ...(r.dropped ? { note: "Older entries were dropped (the buffer keeps the last 500)." } : {}),
    hint: "Pass since: lastSeq next time to get only newer entries.",
  };
}

const isHistoryAction = (raw: unknown): raw is HistoryAction =>
  raw === "back" || raw === "forward" || raw === "reload";

export async function handleNavigate(
  db: Database.Database,
  ctx: BrowserToolContext,
  pane: BrowserPaneHandle,
  args: Record<string, unknown>,
) {
  touch(db, ctx, pane);
  const mark = markAction(pane, args.snapshot);
  if (args.action === undefined) {
    pane.loadUrl(checkUrlArg(db, ctx, args.url));
  } else if (!isHistoryAction(args.action)) {
    throw new ExegolToolError("action must be back, forward or reload", -32602);
  } else if (!pane.history(args.action)) {
    return {
      status: "no_history",
      pane: pane.paneId,
      hint: `There is no page to go ${args.action} to.`,
    };
  }
  return pageSummary(db, ctx, pane, mark);
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
  snapshot: unknown,
) {
  const ref = parseRef(refArg);
  if (!ref) {
    throw new ExegolToolError("ref must look like e12.k3x (from browser_snapshot)", -32602);
  }
  const { page, host, needsUser, loadFailed } = await inspect(db, ctx, pane);
  if (!page) return pageUnavailable(pane, needsUser, loadFailed);
  touch(db, ctx, pane);
  const reacts = act.action !== "select" && (act.action !== "type" || act.submit);
  const mark = markAction(pane, snapshot, reacts ? page : undefined);
  const r = (await runGuarded(() =>
    pane.runIsolated(actionScript(ref, act, host)),
  )) as ActionResult | null;
  if (r?.error === "password") {
    throw new ExegolToolError(
      "Refused: that looks like a password field. Agents never type passwords: call browser_wait_for_user and let the user log in.",
      -32024,
    );
  }
  if (r?.error === "obscured") {
    return {
      status: "obscured",
      pane: pane.paneId,
      untrusted_page_content: { covered_by: r.by },
      hint: "Another element is on top of this one, so a user could not click it: close what covers it (a dialog, a menu, a banner), or pass force: true to click it anyway.",
    };
  }
  if (r?.error === "stale_ref") {
    throw new ExegolToolError(
      `${ref} is not on the page anymore (it changed or navigated): take a new browser_snapshot`,
      -32025,
    );
  }
  if (r?.error === "no_option") {
    return {
      status: "no_option",
      pane: pane.paneId,
      untrusted_page_content: { options: r.options },
      hint: "That value is not an option of this select: pick one of options.",
    };
  }
  if (!r?.ok) {
    throw new ExegolToolError(`${act.action} failed on ${ref}: ${r?.error ?? "no result"}`, -32026);
  }
  if (r.submitted === "enter") pane.sendKey("Enter", []);
  if (r.x !== undefined && r.y !== undefined) pane.moveMouse(r.x, r.y);
  return pageSummary(db, ctx, pane, mark, { submitted: r.submitted, actualValue: r.actual });
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
  const { page, needsUser, loadFailed } = await inspect(db, ctx, pane);
  if (!page) return pageUnavailable(pane, needsUser, loadFailed);
  if (page.focusSecret) {
    throw new ExegolToolError(
      "Refused: a password field has the focus. Agents never type passwords.",
      -32024,
    );
  }
  touch(db, ctx, pane);
  await pane.runIsolated(watchScript());
  const mark = markAction(pane, args.snapshot, page);
  pane.sendKey(key.keyCode, key.modifiers);
  return pageSummary(db, ctx, pane, mark);
}

const SCROLL_TARGETS: readonly unknown[] = ["down", "up", "top", "bottom"];

export async function handleScroll(
  db: Database.Database,
  ctx: BrowserToolContext,
  pane: BrowserPaneHandle,
  args: Record<string, unknown>,
) {
  const ref = args.ref === undefined ? null : parseRef(args.ref);
  if (args.ref !== undefined && !ref) {
    throw new ExegolToolError("ref must look like e12.k3x (from browser_snapshot)", -32602);
  }
  const to = (args.to ?? "down") as ScrollTarget;
  if (!SCROLL_TARGETS.includes(to)) {
    throw new ExegolToolError("to must be down, up, top or bottom", -32602);
  }
  const { page, host, needsUser, loadFailed } = await inspect(db, ctx, pane);
  if (!page) return pageUnavailable(pane, needsUser, loadFailed);
  touch(db, ctx, pane);
  const mark = markAction(pane, args.snapshot, page);
  const r = (await runGuarded(() => pane.runIsolated(scrollScript(ref, to, host)))) as {
    error?: string;
    atEnd?: boolean;
  } | null;
  if (r?.error === "stale_ref") {
    throw new ExegolToolError(
      `${ref} is not on the page anymore (it changed or navigated): take a new browser_snapshot`,
      -32025,
    );
  }
  return pageSummary(db, ctx, pane, mark, { atEnd: r?.atEnd });
}

const WAIT_POLL_MS = 200;
const DEFAULT_WAIT_S = 5;
const MAX_WAIT_S = 20;

const optionalText = (raw: unknown): string | undefined =>
  typeof raw === "string" && raw ? raw : undefined;

export async function handleWaitFor(
  db: Database.Database,
  ctx: BrowserToolContext,
  pane: BrowserPaneHandle,
  args: Record<string, unknown>,
) {
  const condition = {
    text: optionalText(args.text),
    gone: optionalText(args.gone),
    url: optionalText(args.url),
  };
  if (!condition.text && !condition.gone && !condition.url) {
    throw new ExegolToolError("pass text, gone or url", -32602);
  }
  const asked = Number(args.timeout_seconds);
  const seconds = asked > 0 ? Math.min(asked, MAX_WAIT_S) : DEFAULT_WAIT_S;
  const started = Date.now();
  const mark = markAction(pane, args.snapshot);
  while (Date.now() - started < seconds * 1000) {
    let met = false;
    try {
      const { page, host, needsUser, loadFailed } = await inspect(db, ctx, pane);
      if (!page) return pageUnavailable(pane, needsUser, loadFailed);
      met = (await pane.runIsolated(waitScript(condition, host))) === true;
    } catch (err) {
      // A page mid-navigation has nothing to read yet: the next poll does
      if (!isPageChangedError(err) && !(err instanceof ExegolToolError && err.code === -32021)) {
        throw err;
      }
    }
    if (met) return pageSummary(db, ctx, pane, mark, { waitedMs: Date.now() - started });
    await delay(WAIT_POLL_MS);
  }
  return {
    status: "timed_out",
    pane: pane.paneId,
    hint: `It did not happen in ${seconds} s. browser_snapshot shows the page, browser_logs its errors.`,
  };
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
  const { page, host, needsUser, loadFailed } = await inspect(db, ctx, pane);
  if (!page) return pageUnavailable(pane, needsUser, loadFailed);
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
