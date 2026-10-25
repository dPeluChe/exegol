import { beforeEach, describe, expect, it } from "vitest";
import {
  CHURN_COOLDOWNS_MS,
  CHURN_PAGES,
  CHURN_WINDOW_MS,
  claimPages,
  createChurnMeter,
  notePage,
  resetPageNotes,
} from "./atlas-churn";

beforeEach(resetPageNotes);

describe("page notes", () => {
  it("count a page once however many views forward it, and a claim empties them", () => {
    const page = {};
    notePage(page);
    notePage(page);
    notePage({});
    expect(claimPages()).toBe(2);
    expect(claimPages()).toBe(0);
    notePage(page);
    expect(claimPages()).toBe(0);
  });
});

describe("createChurnMeter", () => {
  it("trips once the window holds CHURN_PAGES and starts the window over", () => {
    const meter = createChurnMeter();
    expect(meter.record(CHURN_PAGES - 1, 0)).toBeNull();
    expect(meter.record(1, 500)).toEqual({
      pages: CHURN_PAGES,
      overMs: 500,
      domForMs: CHURN_COOLDOWNS_MS[0],
    });
    expect(meter.record(1, 600)).toBeNull();
  });

  it("pages spread wider than the window never trip", () => {
    const meter = createChurnMeter();
    for (let t = 0; t < 100; t++) {
      expect(meter.record(CHURN_PAGES / 2, t * CHURN_WINDOW_MS)).toBeNull();
    }
  });

  it("repeats stay off longer, capped at the last cooldown; a calm 10 min starts over", () => {
    const meter = createChurnMeter();
    const trips = [0, 1, 2, 3].map((i) => meter.record(CHURN_PAGES, i * 60_000)?.domForMs);
    expect(trips).toEqual([...CHURN_COOLDOWNS_MS, CHURN_COOLDOWNS_MS.at(-1)]);
    expect(meter.record(CHURN_PAGES, 3 * 60_000 + 600_001)?.domForMs).toBe(CHURN_COOLDOWNS_MS[0]);
  });
});
