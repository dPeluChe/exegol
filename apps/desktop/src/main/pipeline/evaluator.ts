import {
  DEFAULT_EVALUATOR_GATE_POLICY,
  type EvaluatorGatePolicy,
  type EvaluatorVerdict,
} from "@exegol/shared";
import { logger } from "../lib/logger";

/**
 * T88v2 — Evaluator gate judge. Two-pass per call (describe, then verdict) to
 * reduce judge rationalization, run N times independently for a score
 * distribution instead of a single PASS/RETRY, and priced per call so loop
 * cost is visible (feeds T130 evidence).
 *
 * Approximate Haiku pricing — T147 (Cost Dashboard) owns the real editable
 * price table; this is a placeholder good enough to make cost visible now.
 */
const HAIKU_PRICE_PER_MTOK_INPUT = 1.0;
const HAIKU_PRICE_PER_MTOK_OUTPUT = 5.0;

const MAX_DIFF_CHARS = 20_000;
const DEFAULT_JUDGE_CALLS = 3;

interface HaikuUsage {
  text: string;
  costUsd: number;
}

async function callHaiku(apiKey: string, prompt: string, maxTokens: number): Promise<HaikuUsage> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: maxTokens,
      messages: [{ role: "user", content: prompt }],
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`Anthropic API ${res.status}: ${res.statusText}`);

  const data = (await res.json()) as {
    content?: Array<{ text?: string }>;
    usage?: { input_tokens?: number; output_tokens?: number };
  };
  const text = (data.content?.[0]?.text ?? "").trim();
  const inputTokens = data.usage?.input_tokens ?? 0;
  const outputTokens = data.usage?.output_tokens ?? 0;
  const costUsd =
    (inputTokens / 1_000_000) * HAIKU_PRICE_PER_MTOK_INPUT +
    (outputTokens / 1_000_000) * HAIKU_PRICE_PER_MTOK_OUTPUT;
  return { text, costUsd };
}

interface JudgeCallResult {
  score: number;
  description: string;
  costUsd: number;
}

/** One independent judge call: pass 1 describes the diff adversarially
 *  (without judging), pass 2 issues a 0-1 verdict from that description. */
async function judgeOnce(
  apiKey: string,
  diff: string,
  acceptanceCriteria: string,
): Promise<JudgeCallResult> {
  const truncated = diff.slice(0, MAX_DIFF_CHARS);

  const describePrompt = `You are adversarially reviewing a code diff — assume it is broken or incomplete until proven otherwise. Describe factually what it actually changes, any gaps versus what it claims to do, and anything suspicious. Do not render a verdict yet.

Diff:

${truncated}

Respond with 3-6 sentences of plain factual description. No verdict, no score, no markdown.`;

  const pass1 = await callHaiku(apiKey, describePrompt, 300);

  const verdictPrompt = `Acceptance criteria for this change:

${acceptanceCriteria}

An adversarial description of what the diff actually does:

${pass1.text}

Based ONLY on the description above, does the change meet the acceptance criteria?
Respond with ONLY a JSON object: {"score": N} where N is 0.0-1.0 (1.0 = fully meets criteria).`;

  const pass2 = await callHaiku(apiKey, verdictPrompt, 60);

  const match = pass2.text.match(/\{[^}]+\}/);
  let score = 0;
  if (match) {
    try {
      const parsed = JSON.parse(match[0]) as { score?: number };
      if (typeof parsed.score === "number" && parsed.score >= 0 && parsed.score <= 1) {
        score = parsed.score;
      }
    } catch {
      // fall through with score 0
    }
  }

  return { score, description: pass1.text, costUsd: pass1.costUsd + pass2.costUsd };
}

export function decide(
  avgScore: number,
  policy: EvaluatorGatePolicy,
): EvaluatorVerdict["decision"] {
  if (avgScore >= policy.shipThreshold) return "ship";
  if (avgScore >= policy.holdThreshold) return "hold";
  return "retry";
}

/**
 * Run the full evaluator gate: N independent two-pass judge calls, score
 * distribution, gate decision. Never throws — a failed judge call scores 0
 * for that call rather than aborting the whole gate.
 */
export async function runEvaluatorGate(
  apiKey: string | null,
  diff: string,
  acceptanceCriteria: string,
  opts: { judgeCalls?: number; gatePolicy?: EvaluatorGatePolicy } = {},
): Promise<EvaluatorVerdict> {
  const policy = opts.gatePolicy ?? DEFAULT_EVALUATOR_GATE_POLICY;

  if (!apiKey) {
    logger.warn("[Evaluator] No Anthropic API key configured — gate holds for human review");
    return { decision: "hold", scores: [], avgScore: 0, feedback: "", costUsd: 0 };
  }

  // Clamp: judgeCalls 0 would make avgScore NaN → 'retry' forever; huge values
  // are an unbounded parallel cost spike (UI min/max attrs don't validate typed input).
  const n = Math.max(1, Math.min(5, opts.judgeCalls ?? DEFAULT_JUDGE_CALLS));
  const results = await Promise.all(
    Array.from({ length: n }, () =>
      judgeOnce(apiKey, diff, acceptanceCriteria).catch((err) => {
        logger.warn("[Evaluator] Judge call failed:", err);
        return { score: 0, description: "", costUsd: 0, failed: true as const };
      }),
    ),
  );

  // Infrastructure failure is not a code-quality verdict: if every judge call
  // failed (API outage, rate limit), hold for a human instead of burning
  // retry loops against a phantom low score.
  if (results.every((r) => "failed" in r && r.failed)) {
    logger.warn("[Evaluator] All judge calls failed — holding for human review");
    return {
      decision: "hold",
      scores: [],
      avgScore: 0,
      feedback: "All judge calls failed (API outage or rate limit) — resume to re-judge.",
      costUsd: 0,
    };
  }

  const scores = results.map((r) => r.score);
  const avgScore = scores.reduce((a, b) => a + b, 0) / scores.length;
  const costUsd = results.reduce((a, r) => a + r.costUsd, 0);
  const decision = decide(avgScore, policy);

  const lowest = results.reduce(
    (min, r) => (r.score < min.score ? r : min),
    results[0] ?? { score: 0, description: "", costUsd: 0 },
  );
  const feedback =
    decision === "retry" && lowest?.description
      ? `Evaluator feedback (score ${lowest.score.toFixed(2)}): ${lowest.description}`
      : "";

  return { decision, scores, avgScore, feedback, costUsd };
}
