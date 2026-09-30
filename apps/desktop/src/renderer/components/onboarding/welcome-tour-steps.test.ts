import { describe, expect, it } from "vitest";
import { WELCOME_TOUR_STEPS } from "./welcome-tour-steps";

describe("WELCOME_TOUR_STEPS", () => {
  it("has 5-7 steps, each with a title and 3-5 bullets", () => {
    expect(WELCOME_TOUR_STEPS.length).toBeGreaterThanOrEqual(5);
    expect(WELCOME_TOUR_STEPS.length).toBeLessThanOrEqual(7);
    for (const step of WELCOME_TOUR_STEPS) {
      expect(step.title.trim()).not.toBe("");
      expect(step.bullets.length).toBeGreaterThanOrEqual(3);
      expect(step.bullets.length).toBeLessThanOrEqual(5);
      for (const bullet of step.bullets) expect(bullet.trim()).not.toBe("");
    }
  });

  it("titles are unique (used as keys)", () => {
    const titles = WELCOME_TOUR_STEPS.map((s) => s.title);
    expect(new Set(titles).size).toBe(titles.length);
  });
});
