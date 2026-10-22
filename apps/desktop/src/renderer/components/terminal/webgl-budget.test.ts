import { describe, expect, it, vi } from "vitest";
import { createWebglBudget } from "./webgl-budget";

describe("createWebglBudget", () => {
  it("grants up to the cap, then denies and remembers it was capped", () => {
    const budget = createWebglBudget(2);
    expect(budget.acquire()).toBe(true);
    expect(budget.acquire()).toBe(true);
    expect(budget.capped()).toBe(false);
    expect(budget.acquire()).toBe(false);
    expect(budget.capped()).toBe(true);
    expect(budget.live()).toBe(2);
  });

  it("hands a freed slot to the first terminal that waited", () => {
    const budget = createWebglBudget(1);
    budget.acquire();
    const first = vi.fn(() => budget.acquire());
    const second = vi.fn();
    budget.acquire(first);
    budget.acquire(second);
    budget.release();
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).not.toHaveBeenCalled();
    expect(budget.live()).toBe(1);
  });

  it("forgets a waiter that went away", () => {
    const budget = createWebglBudget(1);
    budget.acquire();
    const waiter = vi.fn();
    budget.acquire(waiter);
    budget.cancelWait(waiter);
    budget.release();
    expect(waiter).not.toHaveBeenCalled();
    expect(budget.live()).toBe(0);
  });

  it("DOM-only mode denies every new context and drops the waiters", () => {
    const budget = createWebglBudget(4);
    budget.acquire();
    const waiter = vi.fn();
    budget.setDomOnly();
    expect(budget.acquire(waiter)).toBe(false);
    budget.release();
    expect(waiter).not.toHaveBeenCalled();
    expect(budget.isDomOnly()).toBe(true);
  });

  it("reports each change of the live count and the first cap hit", () => {
    const onChange = vi.fn();
    const budget = createWebglBudget(1, onChange);
    budget.acquire();
    budget.acquire();
    budget.acquire();
    budget.release();
    expect(onChange).toHaveBeenCalledTimes(3);
  });

  it("at the cap evicts the oldest parked context and hands its slot over", () => {
    const budget = createWebglBudget(2);
    budget.acquire();
    budget.acquire();
    const older = vi.fn();
    const newer = vi.fn();
    budget.park(older);
    budget.park(newer);
    expect(budget.acquire()).toBe(true);
    expect(older).toHaveBeenCalledTimes(1);
    expect(newer).not.toHaveBeenCalled();
    expect(budget.live()).toBe(2);
  });

  it("a terminal shown again leaves the parked list", () => {
    const budget = createWebglBudget(1);
    budget.acquire();
    const evict = vi.fn();
    budget.park(evict);
    budget.unpark(evict);
    expect(budget.acquire()).toBe(false);
    expect(evict).not.toHaveBeenCalled();
  });

  it("parking gives the slot to a shown terminal that waited", () => {
    const budget = createWebglBudget(1);
    budget.acquire();
    const waiter = vi.fn(() => budget.acquire());
    budget.acquire(waiter);
    const evict = vi.fn();
    budget.park(evict);
    expect(evict).toHaveBeenCalledTimes(1);
    expect(waiter).toHaveBeenCalledTimes(1);
    expect(budget.live()).toBe(1);
  });
});
