import { hostOf, isOutsideAllowlist, LOCAL_HOST_PATTERNS } from "@exegol/shared";
import type Database from "libsql";
import { getProject } from "../db/queries/projects";
import { HISTORY_ACTIONS, SCROLL_TARGETS } from "../mcp/browser-tool-defs";
import { ExegolToolError } from "../mcp/exegol-protocol";
import { getPaneControl, lastPaneOf, markOpenedBy } from "./control";
import { isLogLevel } from "./log-ring";
import { type ActionResult, actionScript, type PageAction, scrollScript } from "./page-actions";
import {
  guardedEvalScript,
  isPageChangedError,
  parseKey,
  parseRef,
  watchScript,
} from "./page-scripts";
import {
  actBlocked,
  allowedHostsOf,
  type BrowserPaneHandle,
  type BrowserToolContext,
  checkUrlArg,
  inspect,
  logAction,
  needsUserResult,
  PAGE_CHANGED,
  pageUnavailable,
  requireHost,
  resolvePane,
  touch,
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
        canAct: !actBlocked(p, ctx.agentId),
        openedByYou: c?.openedBy === ctx.agentId,
      };
    }),
    allowedHosts: [...LOCAL_HOST_PATTERNS, ...allowed],
    ...(panes.length === 0
      ? { hint: 'No pane is live: browser_open opens one (url, or "dev" for the dev server).' }
      : {}),
  };
}

// A pane nobody named may be what the user is reading
function paneToReuse(ctx: BrowserToolContext, requested: unknown): BrowserPaneHandle | null {
  const live = requireHost().livePanes(ctx.projectId);
  if (requested) return resolvePane(live, ctx, requested);
  const last = lastPaneOf(
    ctx.agentId,
    live.map((p) => p.paneId),
  );
  return live.find((p) => p.paneId === last) ?? null;
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
  const reuse = readOnly || args.new_pane === true ? null : paneToReuse(ctx, args.pane);
  const blocked = reuse && actBlocked(reuse, ctx.agentId);
  if (blocked) return blocked;
  let pane: BrowserPaneHandle;
  if (reuse) {
    pane = reuse;
    touch(db, ctx, pane);
    pane.loadUrl(url);
  } else {
    pane = await h.openPane({ projectId: ctx.projectId, agentId: ctx.agentId, url });
    markOpenedBy(pane.paneId, ctx.projectId, ctx.agentId);
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

export function handleClose(
  db: Database.Database,
  ctx: BrowserToolContext,
  args: Record<string, unknown>,
) {
  const h = requireHost();
  const pane = resolvePane(h.livePanes(ctx.projectId), ctx, args.pane);
  if (getPaneControl(pane.paneId)?.openedBy !== ctx.agentId) {
    return {
      status: "not_yours",
      pane: pane.paneId,
      hint: "You did not open this pane, so it stays: the user or another agent may be using it.",
    };
  }
  const blocked = actBlocked(pane, ctx.agentId);
  if (blocked) return blocked;
  if (!h.closePane(pane.paneId)) {
    throw new ExegolToolError("Exegol's window is closed: no pane can close", -32603);
  }
  logAction(db, ctx, {
    tool: "browser_close",
    paneId: pane.paneId,
    host: hostOf(pane.getUrl()),
    outcome: "closed",
  });
  return { status: "closed", pane: pane.paneId };
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

const oneOf = <T extends string>(list: readonly T[], raw: unknown): raw is T =>
  list.includes(raw as T);

export async function handleNavigate(
  db: Database.Database,
  ctx: BrowserToolContext,
  pane: BrowserPaneHandle,
  args: Record<string, unknown>,
) {
  if (args.action !== undefined && !oneOf(HISTORY_ACTIONS, args.action)) {
    throw new ExegolToolError(`action must be one of ${HISTORY_ACTIONS.join(", ")}`, -32602);
  }
  touch(db, ctx, pane);
  const mark = markAction(pane, args.snapshot);
  if (args.action === undefined) {
    pane.loadUrl(checkUrlArg(db, ctx, args.url));
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

function requireRef(raw: unknown): string {
  const ref = parseRef(raw);
  if (!ref) {
    throw new ExegolToolError("ref must look like e12.k3x (from browser_snapshot)", -32602);
  }
  return ref;
}

const staleRef = (ref: string) =>
  new ExegolToolError(
    `${ref} is not on the page anymore (it changed or navigated): take a new browser_snapshot`,
    -32025,
  );

export async function runAction(
  db: Database.Database,
  ctx: BrowserToolContext,
  pane: BrowserPaneHandle,
  refArg: unknown,
  act: PageAction,
  snapshot: unknown,
) {
  const ref = requireRef(refArg);
  const { page, host, needsUser, loadFailed } = await inspect(db, ctx, pane);
  if (!page) return pageUnavailable(pane, needsUser, loadFailed);
  touch(db, ctx, pane);
  const reacts = act.action === "click" || (act.action === "type" && act.submit);
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
      hint: "Another element is on top of this one, so a user could not reach it: close what covers it (a dialog, a menu, a banner), or pass force: true to go ahead anyway.",
    };
  }
  if (r?.error === "stale_ref") throw staleRef(ref);
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
  if (r.hoverAt) pane.moveMouse(r.hoverAt.x, r.hoverAt.y);
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

export async function handleScroll(
  db: Database.Database,
  ctx: BrowserToolContext,
  pane: BrowserPaneHandle,
  args: Record<string, unknown>,
) {
  const ref = args.ref === undefined ? null : requireRef(args.ref);
  const to = args.to ?? "down";
  if (!oneOf(SCROLL_TARGETS, to)) {
    throw new ExegolToolError(`to must be one of ${SCROLL_TARGETS.join(", ")}`, -32602);
  }
  const { page, host, needsUser, loadFailed } = await inspect(db, ctx, pane);
  if (!page) return pageUnavailable(pane, needsUser, loadFailed);
  touch(db, ctx, pane);
  const mark = markAction(pane, args.snapshot, page);
  const r = (await runGuarded(() => pane.runIsolated(scrollScript(ref, to, host)))) as {
    ok?: boolean;
    error?: string;
    atEnd?: boolean;
  } | null;
  if (r?.error === "stale_ref") throw staleRef(ref as string);
  if (!r?.ok) throw new ExegolToolError(`scroll failed: ${r?.error ?? "no result"}`, -32026);
  return pageSummary(db, ctx, pane, mark, { atEnd: r.atEnd });
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
