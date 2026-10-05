import { createHash } from "node:crypto";
import { z } from "zod";
import { parseJson } from "../../lib/parse-json";

/** What one `gh pr view` (+ inline review comments) tells us about a PR. Pure: no IO here. */
export interface PrSnapshot {
  number: number;
  url: string;
  state: string;
  headSha: string;
  conflicting: boolean;
  failingChecks: Array<{ name: string; link: string | null }>;
  feedback: PrFeedback[];
}

export interface PrFeedback {
  id: string;
  author: string;
  /** ms epoch */
  at: number;
  kind: "changes_requested" | "review" | "comment" | "inline";
  body: string;
  /** "src/a.ts:12" for inline comments */
  location?: string;
}

export type ReactionKind = "checks" | "review" | "conflict";

export interface PrReaction {
  kind: ReactionKind;
  text: string;
  /** Short line for the attention item and desktop notification */
  summary: string;
}

export interface PrWatchState {
  headSha: string | null;
  /** Content hashes already delivered for this head SHA */
  sent: Set<string>;
  perKind: Record<ReactionKind, number>;
  /** Feedback ids already reported; survives a new head SHA so old comments never come back */
  seenFeedback: Set<string>;
  /** Feedback older than this predates the watch: baseline, not news */
  since: number;
  wakes: number;
}

export const MAX_PER_KIND = 3;
export const MAX_WAKES = 10;
const MAX_FEEDBACK_ITEMS = 5;
const MAX_BODY_CHARS = 400;

export function newWatchState(since: number): PrWatchState {
  return {
    headSha: null,
    sent: new Set(),
    perKind: { checks: 0, review: 0, conflict: 0 },
    seenFeedback: new Set(),
    since,
    wakes: 0,
  };
}

// ─── gh JSON → snapshot ────────────────────────────────────────────────────

const author = z.object({ login: z.string() }).nullish();
const prViewSchema = z.object({
  number: z.number(),
  url: z.string(),
  state: z.string(),
  headRefOid: z.string(),
  mergeable: z.string().nullish(),
  mergeStateStatus: z.string().nullish(),
  statusCheckRollup: z
    .array(
      z.object({
        __typename: z.string().optional(),
        name: z.string().nullish(),
        context: z.string().nullish(),
        conclusion: z.string().nullish(),
        state: z.string().nullish(),
        detailsUrl: z.string().nullish(),
        targetUrl: z.string().nullish(),
      }),
    )
    .nullish(),
  reviews: z
    .array(
      z.object({
        id: z.string(),
        author,
        body: z.string().nullish(),
        state: z.string(),
        submittedAt: z.string().nullish(),
      }),
    )
    .nullish(),
  comments: z
    .array(
      z.object({
        id: z.string(),
        author,
        body: z.string(),
        createdAt: z.string(),
      }),
    )
    .nullish(),
});

const inlineCommentsSchema = z.array(
  z.object({
    id: z.number(),
    user: z.object({ login: z.string() }).nullish(),
    body: z.string(),
    path: z.string(),
    line: z.number().nullish(),
    original_line: z.number().nullish(),
    created_at: z.string(),
  }),
);

// CheckRun conclusions and StatusContext states that mean "this needs a fix"
const FAILED = new Set([
  "FAILURE",
  "ERROR",
  "TIMED_OUT",
  "CANCELLED",
  "ACTION_REQUIRED",
  "STARTUP_FAILURE",
]);

const ts = (iso: string | null | undefined) => (iso ? Date.parse(iso) || 0 : 0);

export function parsePrSnapshot(viewJson: string, inlineJson: string | null): PrSnapshot | null {
  const view = parseJson(viewJson, prViewSchema);
  if (!view) return null;
  const failingChecks = (view.statusCheckRollup ?? [])
    .filter((c) => FAILED.has((c.conclusion ?? c.state ?? "").toUpperCase()))
    .map((c) => ({
      name: c.name ?? c.context ?? "check",
      link: c.detailsUrl ?? c.targetUrl ?? null,
    }));

  const feedback: PrFeedback[] = [];
  for (const r of view.reviews ?? []) {
    const body = r.body?.trim() ?? "";
    const changes = r.state === "CHANGES_REQUESTED";
    // An approval or an empty COMMENTED review (the inline comments carry it) is not news
    if (!changes && (r.state !== "COMMENTED" || !body)) continue;
    feedback.push({
      id: `review:${r.id}`,
      author: r.author?.login ?? "unknown",
      at: ts(r.submittedAt),
      kind: changes ? "changes_requested" : "review",
      body,
    });
  }
  for (const c of view.comments ?? []) {
    feedback.push({
      id: `comment:${c.id}`,
      author: c.author?.login ?? "unknown",
      at: ts(c.createdAt),
      kind: "comment",
      body: c.body.trim(),
    });
  }
  for (const c of (inlineJson && parseJson(inlineJson, inlineCommentsSchema)) || []) {
    const line = c.line ?? c.original_line;
    feedback.push({
      id: `inline:${c.id}`,
      author: c.user?.login ?? "unknown",
      at: ts(c.created_at),
      kind: "inline",
      body: c.body.trim(),
      location: line ? `${c.path}:${line}` : c.path,
    });
  }

  return {
    number: view.number,
    url: view.url,
    state: view.state,
    headSha: view.headRefOid,
    conflicting: view.mergeable === "CONFLICTING" || view.mergeStateStatus === "DIRTY",
    failingChecks,
    feedback,
  };
}

// ─── snapshot → reactions ──────────────────────────────────────────────────

const hash = (s: string) => createHash("sha1").update(s).digest("hex").slice(0, 16);
const clip = (s: string) => {
  const flat = s.replace(/\s+/g, " ").trim();
  return flat.length > MAX_BODY_CHARS ? `${flat.slice(0, MAX_BODY_CHARS)}…` : flat;
};

export function buildChecksMessage(pr: PrSnapshot): PrReaction {
  const list = pr.failingChecks.map((c) => `- ${c.name}${c.link ? `: ${c.link}` : ""}`).join("\n");
  const names = pr.failingChecks.map((c) => c.name).join(", ");
  return {
    kind: "checks",
    summary: `PR #${pr.number}: failing checks (${names})`,
    text:
      `PR #${pr.number} (${pr.url}) has failing checks on ${pr.headSha.slice(0, 7)}:\n${list}\n` +
      `Run \`gh pr checks ${pr.number}\` for details and fix the failures that come from your changes.`,
  };
}

export function buildReviewMessage(pr: PrSnapshot, items: PrFeedback[]): PrReaction {
  const shown = items.slice(0, MAX_FEEDBACK_ITEMS);
  const lines = shown.map((f) => {
    const what =
      f.kind === "changes_requested"
        ? "requested changes"
        : f.kind === "inline"
          ? `on ${f.location}`
          : "commented";
    return `- @${f.author} ${what}${f.body ? `: ${clip(f.body)}` : ""}`;
  });
  const more = items.length > shown.length ? `\n(${items.length - shown.length} more)` : "";
  const changes = items.some((f) => f.kind === "changes_requested");
  return {
    kind: "review",
    summary: `PR #${pr.number}: ${changes ? "changes requested" : `${items.length} new review comment${items.length === 1 ? "" : "s"}`}`,
    text:
      `New review feedback on PR #${pr.number} (${pr.url}):\n${lines.join("\n")}${more}\n` +
      `Read it in full with \`gh pr view ${pr.number} --comments\` and address what applies.`,
  };
}

export function buildConflictMessage(pr: PrSnapshot): PrReaction {
  return {
    kind: "conflict",
    summary: `PR #${pr.number}: merge conflicts`,
    text:
      `PR #${pr.number} (${pr.url}) has merge conflicts with its base branch. ` +
      "Bring the base branch in, resolve the conflicts and push.",
  };
}

/**
 * Decide what to tell the agent about this snapshot, and record it in `state`.
 * Dedup on content, at most MAX_PER_KIND per kind per head SHA, MAX_WAKES for the
 * whole watch (t3code pullRequestWatch, agent-orchestrator reactions).
 */
export function computeReactions(
  state: PrWatchState,
  pr: PrSnapshot,
  selfLogin: string | null,
): PrReaction[] {
  if (pr.state !== "OPEN") return [];
  if (state.headSha !== pr.headSha) {
    state.headSha = pr.headSha;
    state.sent.clear();
    state.perKind = { checks: 0, review: 0, conflict: 0 };
  }

  const candidates: PrReaction[] = [];
  if (pr.failingChecks.length > 0) candidates.push(buildChecksMessage(pr));
  if (pr.conflicting) candidates.push(buildConflictMessage(pr));

  const fresh = pr.feedback.filter(
    (f) =>
      !state.seenFeedback.has(f.id) &&
      f.at >= state.since &&
      // The agent posts through the user's gh login: those remarks are its own
      (!selfLogin || f.author.toLowerCase() !== selfLogin.toLowerCase()),
  );
  for (const f of pr.feedback) state.seenFeedback.add(f.id);
  if (fresh.length > 0) candidates.push(buildReviewMessage(pr, fresh));

  const out: PrReaction[] = [];
  for (const r of candidates) {
    if (state.wakes >= MAX_WAKES) break;
    const key = hash(`${r.kind}\n${r.text}`);
    if (state.sent.has(key) || state.perKind[r.kind] >= MAX_PER_KIND) continue;
    state.sent.add(key);
    state.perKind[r.kind]++;
    state.wakes++;
    out.push(r);
  }
  return out;
}
