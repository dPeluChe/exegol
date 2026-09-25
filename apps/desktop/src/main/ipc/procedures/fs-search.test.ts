import { TRPCError } from "@trpc/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const fsSearch = vi.fn();
const fsGrep = vi.fn();

vi.mock("../../agents/spawn-env", () => ({
  coreRust: {
    fsSearch: (...args: unknown[]) => fsSearch(...args),
    fsGrep: (...args: unknown[]) => fsGrep(...args),
  },
}));

const allowed = vi.fn(async () => true);
vi.mock("../../security/path-guard", () => ({ isPathAllowed: () => allowed() }));
vi.mock("../../db/queries", () => ({ listProjects: () => [{ path: "/r" }] }));

// Import after mock so coreRust resolves to the stub.
const { fsSearchRouter } = await import("./fs-search");

const caller = fsSearchRouter.createCaller({} as never);

beforeEach(() => {
  fsSearch.mockReset();
  fsGrep.mockReset();
  allowed.mockResolvedValue(true);
});

describe("search root guard", () => {
  it("refuses a root outside the registered projects", async () => {
    allowed.mockResolvedValue(false);
    await expect(caller.grep({ pattern: "secret", root: "/Users/someone" })).rejects.toBeInstanceOf(
      TRPCError,
    );
    expect(fsGrep).not.toHaveBeenCalled();
  });
});

describe("fsSearchRouter.fuzzyFind", () => {
  it("forwards input to coreRust.fsSearch and returns its result", async () => {
    const fake = [{ path: "/r/a.ts", relativePath: "a.ts", score: 250, isDir: false }];
    fsSearch.mockReturnValue(fake);

    const out = await caller.fuzzyFind({
      query: "a",
      root: "/r",
      maxResults: 50,
      maxDepth: 8,
      includeHidden: true,
      respectGitignore: false,
    });

    expect(out).toBe(fake);
    expect(fsSearch).toHaveBeenCalledWith("a", "/r", {
      maxResults: 50,
      maxDepth: 8,
      includeHidden: true,
      respectGitignore: false,
    });
  });

  it("passes empty optional fields as undefined", async () => {
    fsSearch.mockReturnValue([]);
    await caller.fuzzyFind({ query: "", root: "/r" });
    expect(fsSearch).toHaveBeenCalledWith("", "/r", {
      maxResults: undefined,
      maxDepth: undefined,
      includeHidden: undefined,
      respectGitignore: undefined,
    });
  });

  it("rejects empty root", async () => {
    await expect(caller.fuzzyFind({ query: "x", root: "" })).rejects.toBeInstanceOf(TRPCError);
  });

  it("rejects maxResults above hard cap", async () => {
    await expect(
      caller.fuzzyFind({ query: "x", root: "/r", maxResults: 1000 }),
    ).rejects.toBeInstanceOf(TRPCError);
  });

  it("rejects negative maxDepth", async () => {
    await expect(caller.fuzzyFind({ query: "x", root: "/r", maxDepth: -1 })).rejects.toBeInstanceOf(
      TRPCError,
    );
  });
});

describe("fsSearchRouter.grep", () => {
  it("forwards input to coreRust.fsGrep and returns its result", async () => {
    const fake = [
      {
        path: "/r/a.ts",
        relativePath: "a.ts",
        lineNumber: 3,
        line: "needle",
        byteStart: 0,
        byteEnd: 6,
      },
    ];
    fsGrep.mockReturnValue(fake);

    const out = await caller.grep({
      pattern: "needle",
      root: "/r",
      caseInsensitive: true,
      maxMatches: 100,
      maxFileSizeKb: 512,
      globs: ["**/*.ts"],
    });

    expect(out).toBe(fake);
    expect(fsGrep).toHaveBeenCalledWith("needle", "/r", {
      caseInsensitive: true,
      includeHidden: undefined,
      respectGitignore: undefined,
      maxMatches: 100,
      maxFileSizeKb: 512,
      globs: ["**/*.ts"],
    });
  });

  it("rejects empty pattern", async () => {
    await expect(caller.grep({ pattern: "", root: "/r" })).rejects.toBeInstanceOf(TRPCError);
  });

  it("rejects maxMatches above hard cap", async () => {
    await expect(
      caller.grep({ pattern: "x", root: "/r", maxMatches: 99999 }),
    ).rejects.toBeInstanceOf(TRPCError);
  });

  it("rejects maxFileSizeKb above hard cap", async () => {
    await expect(
      caller.grep({ pattern: "x", root: "/r", maxFileSizeKb: 999999 }),
    ).rejects.toBeInstanceOf(TRPCError);
  });

  it("rejects empty glob strings", async () => {
    await expect(caller.grep({ pattern: "x", root: "/r", globs: [""] })).rejects.toBeInstanceOf(
      TRPCError,
    );
  });
});

describe("fsSearchRouter without coreRust", () => {
  it("throws when the native module is unavailable", async () => {
    vi.resetModules();
    vi.doMock("../../agents/spawn-env", () => ({ coreRust: null }));
    const { fsSearchRouter: r } = await import("./fs-search");
    const c = r.createCaller({} as never);
    await expect(c.fuzzyFind({ query: "x", root: "/r" })).rejects.toBeInstanceOf(TRPCError);
    vi.doUnmock("../../agents/spawn-env");
  });
});
