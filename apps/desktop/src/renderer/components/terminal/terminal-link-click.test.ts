import { describe, expect, it, vi } from "vitest";

vi.mock("../../lib/trpc-client", () => ({ trpcInvoke: vi.fn() }));

import { cellAt } from "./terminal-link-providers";

const box = { left: 100, top: 50, width: 800, height: 400 };

describe("cellAt", () => {
  it("maps a point to its 0-based column and 1-based buffer line", () => {
    expect(cellAt(box, 80, 20, 0, { x: 100, y: 50 })).toEqual({ col: 0, y: 1 });
    expect(cellAt(box, 80, 20, 30, { x: 115, y: 75 })).toEqual({ col: 1, y: 32 });
  });

  it("is null outside the screen", () => {
    expect(cellAt(box, 80, 20, 0, { x: 99, y: 60 })).toBeNull();
    expect(cellAt(box, 80, 20, 0, { x: 300, y: 450 })).toBeNull();
  });
});
