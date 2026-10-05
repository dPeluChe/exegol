/** USD per 1M tokens */
export type ModelPrice = { input: number; output: number };

export const MODEL_PRICES: Record<string, ModelPrice> = {
  // Anthropic
  "claude-opus-4-6": { input: 15, output: 75 },
  "claude-sonnet-4-6": { input: 3, output: 15 },
  "claude-haiku-4-5-20251001": { input: 0.8, output: 4 },
  "claude-sonnet-4-5-20250514": { input: 3, output: 15 },
  "claude-3-5-sonnet-20241022": { input: 3, output: 15 },
  "claude-3-5-haiku-20241022": { input: 0.8, output: 4 },
  "claude-3-opus-20240229": { input: 15, output: 75 },
  // OpenAI
  "gpt-5": { input: 2.5, output: 10 },
  "gpt-4o": { input: 2.5, output: 10 },
  "gpt-4o-mini": { input: 0.15, output: 0.6 },
  o3: { input: 10, output: 40 },
  "o4-mini": { input: 1.1, output: 4.4 },
  // Google
  "gemini-2.5-pro": { input: 1.25, output: 10 },
  "gemini-2.5-flash": { input: 0.15, output: 0.6 },
};

const DEFAULT_PRICE: ModelPrice = { input: 3, output: 15 }; // Sonnet

interface ClaudeId {
  family: string;
  version: string;
}

/** `claude-haiku-4-5-20251001` and `claude-3-5-haiku-20241022` both read as haiku 4.5 / 3.5 */
function claudeId(model: string): ClaudeId | null {
  const family = /(opus|sonnet|haiku)/.exec(model)?.[1];
  if (!family) return null;
  const version = model
    .split("-")
    .filter((p) => /^\d{1,2}$/.test(p))
    .join(".");
  return { family, version };
}

const byVersionDesc = (a: ClaudeId, b: ClaudeId) =>
  b.version.localeCompare(a.version, undefined, { numeric: true });

/** Exact id, then Claude family + version (newest of the family if unknown), then prefix, then Sonnet */
export function priceFor(model: string): ModelPrice {
  const prices = MODEL_PRICES;
  const exact = prices[model];
  if (exact) return exact;
  const id = claudeId(model);
  if (id) {
    const family = Object.keys(prices)
      .map((key) => ({ key, ...(claudeId(key) ?? { family: "", version: "" }) }))
      .filter((c) => c.family === id.family)
      .sort(byVersionDesc);
    const match = family.find((c) => c.version === id.version) ?? family[0];
    if (match) return prices[match.key] as ModelPrice;
  }
  const prefix = Object.entries(prices).find(([key]) => model.startsWith(key))?.[1];
  return prefix ?? DEFAULT_PRICE;
}

export function estimateCost(model: string, inputTokens: number, outputTokens: number): number {
  const price = priceFor(model);
  return (inputTokens * price.input + outputTokens * price.output) / 1_000_000;
}

const num = (v: unknown): number => (typeof v === "number" ? v : 0);

/** Cache tokens as input-priced tokens: reads 0.1x, 5 min writes 1.25x, 1 h writes 2x */
export function claudeCacheInput(usage: Record<string, unknown>): number {
  const write = num(usage.cache_creation_input_tokens);
  const split = usage.cache_creation as Record<string, unknown> | undefined;
  const write1h = Math.min(num(split?.ephemeral_1h_input_tokens), write);
  return num(usage.cache_read_input_tokens) * 0.1 + (write - write1h) * 1.25 + write1h * 2;
}
