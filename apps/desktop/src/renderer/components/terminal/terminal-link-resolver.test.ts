import { describe, expect, it, vi } from "vitest";
import { LinkPathResolver } from "./terminal-link-resolver";

const existing = new Set(["src/a.ts", "src/b.ts"]);
const fakeFetch = () =>
  vi.fn(async (texts: string[], _cwd: string | undefined) =>
    texts.map((text) => ({ text, path: existing.has(text) ? `/repo/${text}` : null })),
  );

describe("LinkPathResolver", () => {
  it("asks once for the whole viewport, then answers rows from the cache", async () => {
    const fetch = fakeFetch();
    const resolver = new LinkPathResolver(fetch);
    const viewport = () => ["src/a.ts", "src/b.ts", "nope.ts"];
    const [first, second] = await Promise.all([
      resolver.resolve(["src/a.ts"], undefined, viewport),
      resolver.resolve(["src/b.ts", "nope.ts"], undefined, viewport),
    ]);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0]?.[0]).toEqual(["src/a.ts", "src/b.ts", "nope.ts"]);
    expect(first.get("src/a.ts")).toBe("/repo/src/a.ts");
    expect(second.get("nope.ts")).toBeNull();
    await resolver.resolve(["src/b.ts"], undefined, viewport);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("re-asks about a missing path after a short while", async () => {
    let now = 0;
    const fetch = fakeFetch();
    const resolver = new LinkPathResolver(fetch, () => now);
    await resolver.resolve(["nope.ts"], undefined, () => []);
    now = 5_000;
    await resolver.resolve(["nope.ts"], undefined, () => []);
    expect(fetch).toHaveBeenCalledTimes(1);
    now = 11_000;
    await resolver.resolve(["nope.ts"], undefined, () => []);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("forgets everything when the cwd changes", async () => {
    const fetch = fakeFetch();
    const resolver = new LinkPathResolver(fetch);
    await resolver.resolve(["src/a.ts"], "/one", () => []);
    await resolver.resolve(["src/a.ts"], "/two", () => []);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls[1]?.[1]).toBe("/two");
  });

  it("treats a failed call as no links", async () => {
    const resolver = new LinkPathResolver(async () => {
      throw new Error("offline");
    });
    const out = await resolver.resolve(["src/a.ts"], undefined, () => []);
    expect(out.get("src/a.ts")).toBeNull();
  });
});
