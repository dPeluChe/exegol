import { describe, expect, it } from "vitest";
import { classifyObservation, computeSalience, textSimilarity } from "./salience";

describe("computeSalience", () => {
  it("decays toward zero as days_ago grows", () => {
    const now = 1_000_000;
    const fresh = computeSalience(
      { relevanceScore: 0.8, reinforcementCount: 1, lastReinforcedAt: now },
      now,
    );
    const stale = computeSalience(
      { relevanceScore: 0.8, reinforcementCount: 1, lastReinforcedAt: now - 90 * 86400 },
      now,
    );
    expect(stale).toBeLessThan(fresh);
  });

  it("halves roughly every 30 days", () => {
    const now = 1_000_000;
    const base = computeSalience(
      { relevanceScore: 1, reinforcementCount: 1, lastReinforcedAt: now },
      now,
    );
    const after30Days = computeSalience(
      { relevanceScore: 1, reinforcementCount: 1, lastReinforcedAt: now - 30 * 86400 },
      now,
    );
    expect(after30Days / base).toBeCloseTo(0.5, 1);
  });

  it("increases with reinforcement count", () => {
    const now = 1_000_000;
    const once = computeSalience(
      { relevanceScore: 0.5, reinforcementCount: 1, lastReinforcedAt: now },
      now,
    );
    const reinforced = computeSalience(
      { relevanceScore: 0.5, reinforcementCount: 5, lastReinforcedAt: now },
      now,
    );
    expect(reinforced).toBeGreaterThan(once);
  });
});

describe("classifyObservation", () => {
  it("creates a new memory when no similar candidates exist", () => {
    const decision = classifyObservation("Use pnpm for this repo", []);
    expect(decision.action).toBe("create");
  });

  it("reinforces near-identical content", () => {
    const decision = classifyObservation("Use pnpm for this repo, not npm", [
      { id: "mem1", content: "Use pnpm for this repo, not npm please" },
    ]);
    expect(decision).toEqual({ action: "reinforce", matchId: "mem1" });
  });

  it("supersedes related-but-different content", () => {
    const decision = classifyObservation("Project now requires Node 22", [
      { id: "mem1", content: "Project requires Node 18" },
    ]);
    expect(decision).toEqual({ action: "supersede", matchId: "mem1" });
  });
});

describe("textSimilarity", () => {
  it("is 1 for identical strings", () => {
    expect(textSimilarity("hello world", "hello world")).toBe(1);
  });

  it("is 0 for disjoint strings", () => {
    expect(textSimilarity("hello world", "foo bar")).toBe(0);
  });
});
