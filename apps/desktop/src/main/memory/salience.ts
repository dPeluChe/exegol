/**
 * Memory Salience v2 (T126) — decay + reinforcement + supersession.
 * Inspired by memU's `vector.py` salience formula (lines 25-62).
 */

import type { MemoryEntry } from "@exegol/shared";

const HALF_LIFE_DAYS = 30;
const DECAY_LAMBDA = 0.693; // ln(2) — so exp(-lambda * days/halfLife) halves every 30 days

/**
 * salience = similarity × log(reinforcement_count + 1) × exp(-0.693 × days_ago / 30)
 * `similarity` is approximated by the stored relevance score (how well the fact
 * matched its origin context) since salience is computed at rest, not per-query.
 * reinforcement_count starts at 1 (the initial observation), so a never-reinforced
 * memory still has nonzero salience (log(2) ≈ 0.69), decaying toward 0 as it ages.
 */
export function computeSalience(
  memory: Pick<MemoryEntry, "relevanceScore" | "reinforcementCount" | "lastReinforcedAt">,
  now = Math.floor(Date.now() / 1000),
): number {
  const daysAgo = Math.max(0, (now - memory.lastReinforcedAt) / 86400);
  const reinforcement = Math.log(memory.reinforcementCount + 1);
  const decay = Math.exp((-DECAY_LAMBDA * daysAgo) / HALF_LIFE_DAYS);
  return memory.relevanceScore * reinforcement * decay;
}

// ─── Text similarity (shared dedup/contradiction heuristic) ─────────────────

export function normalizeForDedup(content: string): string {
  return content.toLowerCase().replace(/\s+/g, " ").trim();
}

/** Jaccard-like similarity for short strings. Returns 0-1 where 1 = identical. */
export function textSimilarity(a: string, b: string): number {
  const wordsA = new Set(normalizeForDedup(a).split(" "));
  const wordsB = new Set(normalizeForDedup(b).split(" "));

  let intersection = 0;
  for (const w of wordsA) {
    if (wordsB.has(w)) intersection++;
  }

  const union = wordsA.size + wordsB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

// ─── Observation classification (reinforce / supersede / create) ───────────

/** Same fact re-stated: reinforce the existing row instead of duplicating it. */
export const DUPLICATE_THRESHOLD = 0.8;
/**
 * Related but different content in the same category — likely an update to
 * (or contradiction of) an existing fact: supersede rather than duplicate.
 * Calibrated at 0.5: a true fact-update ("requires Node 18" → "now requires
 * Node 22") scores 0.5, while merely-related facts about different subjects
 * ("port 3006 for craftpanel dev" vs "port 9000 for the backend dev server")
 * score ~0.4 and must NOT supersede — a false supersession silently removes a
 * valid fact from recall. Prefer a duplicate (visible, recoverable) over that.
 */
export const CONTRADICTION_THRESHOLD = 0.5;

export type ObservationDecision =
  | { action: "reinforce"; matchId: string }
  | { action: "supersede"; matchId: string }
  | { action: "create" };

/**
 * Classify a newly-observed fact against existing active memories in the same
 * category. Never overwrites: "supersede" always means insert-new + mark-old.
 */
export function classifyObservation(
  content: string,
  existing: Array<{ id: string; content: string }>,
): ObservationDecision {
  let best: { id: string; sim: number } | null = null;
  for (const candidate of existing) {
    const sim = textSimilarity(content, candidate.content);
    if (!best || sim > best.sim) best = { id: candidate.id, sim };
  }

  if (!best) return { action: "create" };
  if (best.sim >= DUPLICATE_THRESHOLD) return { action: "reinforce", matchId: best.id };
  if (best.sim >= CONTRADICTION_THRESHOLD) return { action: "supersede", matchId: best.id };
  return { action: "create" };
}
