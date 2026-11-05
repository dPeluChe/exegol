import { describe, expect, it } from "vitest";
import { claudeCacheInput, knownCost, priceFor } from "./pricing";

describe("priceFor", () => {
  it("matches the Claude family and version", () => {
    expect(priceFor("claude-haiku-4-5")).toEqual({ input: 0.8, output: 4 });
    expect(priceFor("claude-haiku-4-5-20251001")).toEqual({ input: 0.8, output: 4 });
    expect(priceFor("claude-opus-4-6-20260101")).toEqual({ input: 15, output: 75 });
    // Unknown version: the newest of the family in the table
    expect(priceFor("claude-opus-5-5")).toEqual({ input: 15, output: 75 });
    expect(priceFor("claude-3-5-haiku-latest")).toEqual({ input: 0.8, output: 4 });
  });

  it("keeps prefix matches and returns null for the rest", () => {
    expect(priceFor("gpt-5-codex")).toEqual({ input: 2.5, output: 10 });
    expect(priceFor("mystery-model")).toBeNull();
    expect(priceFor("unknown")).toBeNull();
  });
});

describe("claudeCacheInput", () => {
  it("prices reads at 0.1x, 5 min writes at 1.25x and 1 h writes at 2x", () => {
    expect(
      claudeCacheInput({
        cache_read_input_tokens: 1000,
        cache_creation_input_tokens: 300,
        cache_creation: { ephemeral_1h_input_tokens: 100 },
      }),
    ).toBe(100 + 200 * 1.25 + 100 * 2);
    expect(claudeCacheInput({ input_tokens: 5 })).toBe(0);
  });
});

describe("knownCost", () => {
  it("flags the unpriced model instead of billing it", () => {
    expect(knownCost("mystery-model", 1_000_000, 0)).toEqual({
      estimatedCostUsd: 0,
      costSource: "unpriced",
    });
    expect(knownCost("claude-sonnet-4-6", 1_000_000, 0)).toEqual({
      estimatedCostUsd: 3,
      costSource: "priced",
    });
  });
});
