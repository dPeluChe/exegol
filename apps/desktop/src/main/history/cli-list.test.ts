import { tmpdir } from "node:os";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

vi.mock("../agents/spawn-env", () => ({
  findOnPath: (command: string) => (command === "echo" ? "/bin/echo" : null),
}));

import { cliListing, eachCwd, forgetCliListing } from "./cli-list";
import { hasLocalSession } from "./index";
import { StoreUnavailable } from "./types";

const ids = z.array(z.object({ id: z.string() }));
const dir = tmpdir();

describe("cliListing", () => {
  it("reports a CLI that is not installed as unavailable, not as an empty listing", async () => {
    await expect(cliListing("devin", "devin", ["list"], dir, ids)).rejects.toBeInstanceOf(
      StoreUnavailable,
    );
  });

  // V8 puts the input text in a JSON SyntaxError: a bad listing must not carry it into a log
  it("turns output it cannot parse into StoreUnavailable without the output", async () => {
    const err = await cliListing("t1", "echo", ["secret prompt text"], dir, ids).catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(StoreUnavailable);
    expect(String(err)).not.toContain("secret");
  });

  it("parses against the schema and caches per provider and folder", async () => {
    const first = await cliListing("t2", "echo", ['[{"id":"a"}]'], dir, ids);
    expect(first).toEqual([{ id: "a" }]);
    // Same key: served from the cache, whatever the args
    expect(await cliListing("t2", "echo", ["[]"], dir, ids)).toEqual([{ id: "a" }]);
    forgetCliListing("t2", dir);
    expect(await cliListing("t2", "echo", ["[]"], dir, ids)).toEqual([]);
  });
});

describe("eachCwd", () => {
  it("skips a folder that fails and is unavailable only when every one failed", async () => {
    const fail = () => Promise.reject(new StoreUnavailable("x"));
    expect(
      await eachCwd(["/a", "/b"], (cwd) => (cwd === "/a" ? fail() : Promise.resolve([cwd]))),
    ).toEqual(["/b"]);
    await expect(eachCwd(["/a"], fail)).rejects.toBeInstanceOf(StoreUnavailable);
  });
});

describe("hasLocalSession", () => {
  // null keeps "Continue last" offered with a caveat; false would hide it for nothing
  it("is unknown (null) when the CLI's listing cannot run", async () => {
    expect(await hasLocalSession("devin", dir)).toBeNull();
  });

  it("is unknown (null) for a CLI with no adapter", async () => {
    expect(await hasLocalSession("amp", dir)).toBeNull();
  });
});
