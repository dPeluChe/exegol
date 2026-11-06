import type Database from "libsql";
import { delay } from "../lib/timeout";
import { LOAD_BUDGET_MS } from "./load-state";
import type { NeedsUser } from "./needs-user";
import {
  formatSnapshot,
  type RawSignals,
  type RawSnapshot,
  type SnapshotOptions,
  snapshotCaps,
} from "./page-scripts";
import {
  allowedHostsOf,
  type BrowserPaneHandle,
  type BrowserToolContext,
  inspect,
  needsUserResult,
  pageUnavailable,
  visibleEntries,
} from "./tool-guards";

const LOAD_SETTLE_MS = 400;
const MAX_REPORTED_ERRORS = 5;
const MAX_ERROR_TEXT = 300;
const VIEW_SNAPSHOT: SnapshotOptions = { full: false, offset: 0, textOffset: 0 };

/** Taken before an action, so its result can say what the action did */
export interface ActionMark {
  logSeq: number;
  /** The page before an action meant to change it */
  before?: RawSignals;
  /** The agent asked for a snapshot with the result */
  snapshot: boolean;
}

/** What the action itself knows */
export interface ActionOutcome {
  submitted?: "form" | "enter";
  /** The field holds something else than what was typed: page data */
  actualValue?: string;
}

export const markAction = (
  pane: BrowserPaneHandle,
  snapshot: unknown,
  before?: RawSignals,
): ActionMark => ({ logSeq: pane.logs.lastSeq, before, snapshot: snapshot === true });

function errorsSince(
  db: Database.Database,
  ctx: BrowserToolContext,
  pane: BrowserPaneHandle,
  mark: ActionMark,
): string[] {
  if (pane.logs.lastSeq === mark.logSeq) return [];
  const { entries } = pane.logs.query({
    since: mark.logSeq,
    level: "error",
    limit: MAX_REPORTED_ERRORS,
  });
  return visibleEntries(entries, allowedHostsOf(db, ctx.projectId)).map((e) =>
    e.text.slice(0, MAX_ERROR_TEXT),
  );
}

function changedSince(before: RawSignals, after: RawSignals): boolean {
  // No count means a new document
  if (after.mutations === null || after.mutations > 0) return true;
  return after.url !== before.url;
}

/** What a snapshot returns. A paging call sends only what it pages: the rest came with the first */
export function snapshotView(
  pane: BrowserPaneHandle,
  page: RawSnapshot,
  opts: SnapshotOptions,
  needsUser: NeedsUser | null,
) {
  const { truncated, ...content } = formatSnapshot(page, snapshotCaps(opts.full));
  return {
    pane: pane.paneId,
    url: page.url,
    untrusted_page_content: {
      ...content,
      text: opts.offset > 0 && !opts.textOffset ? "" : content.text,
      elements: opts.textOffset > 0 && !opts.offset ? [] : content.elements,
    },
    truncated,
    ...(truncated
      ? {
          coverage: {
            elements_shown: content.elements.length,
            elements_offscreen: page.offscreen,
            next_offset: page.nextOffset,
            text_length: page.textLength,
          },
        }
      : {}),
    ...(page.framesSkipped ? { iframes_not_readable: page.framesSkipped } : {}),
    ...(needsUser ? { needs_user: needsUserResult(pane, needsUser) } : {}),
    hint: `Act on elements by ref (e12.k3x) with browser_click / browser_type / browser_select. A ref works only on the page it came from: after a navigation, take a new snapshot.${truncated ? " This is part of the page: full: true reads all of it, offset and text_offset continue a long one." : ""}`,
  };
}

/** Waits for what an action started, then says where the pane is and what happened: the url, the
 *  page's title as page data, whether the page reacted, and the errors logged since `mark`. One
 *  read of the page, so a snapshot that fails can never turn a done action into an error */
export async function pageSummary(
  db: Database.Database,
  ctx: BrowserToolContext,
  pane: BrowserPaneHandle,
  mark: ActionMark,
  outcome: ActionOutcome = {},
) {
  await delay(LOAD_SETTLE_MS);
  const stillLoading = await pane.awaitLoad();
  if (stillLoading && !pane.loadState().failure) {
    return {
      status: "loading",
      pane: pane.paneId,
      hint: "The server has not answered yet (a dev server may be compiling). Wait a few seconds and call browser_snapshot; browser_logs shows requests and errors.",
    };
  }
  const full = mark.snapshot ? await inspect(db, ctx, pane, VIEW_SNAPSHOT) : null;
  const { page, needsUser, loadFailed } = full ?? (await inspect(db, ctx, pane));
  if (loadFailed || needsUser) return pageUnavailable(pane, needsUser, loadFailed);
  const errors = errorsSince(db, ctx, pane, mark);
  const httpStatus = pane.lastHttpStatus();
  const changed = mark.before && page ? changedSince(mark.before, page) : undefined;
  const stopped = pane.loadState().stopped;
  const hint =
    changed === false
      ? `The page did not react within ${LOAD_SETTLE_MS / 1000} s: the action may have had no effect, or it is slower than that. browser_snapshot shows the current state, browser_logs the errors.`
      : stopped
        ? `A resource never finished, so Exegol stopped the load after ${LOAD_BUDGET_MS / 1000} s. The page may be partial: browser_logs shows what failed.`
        : undefined;
  return {
    status: "ok",
    pane: pane.paneId,
    url: page?.url,
    submitted: outcome.submitted,
    changed,
    http_status: httpStatus !== null && httpStatus >= 400 ? httpStatus : undefined,
    load_stopped: stopped || undefined,
    untrusted_page_content: {
      title: page?.title.slice(0, 300) ?? "",
      actual_value: outcome.actualValue,
      new_errors: errors.length ? errors : undefined,
    },
    hint,
    snapshot: full?.page ? snapshotView(pane, full.page, VIEW_SNAPSHOT, null) : undefined,
  };
}
