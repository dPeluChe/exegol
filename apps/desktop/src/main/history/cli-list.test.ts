import { describe, expect, it, vi } from "vitest";

vi.mock("../agents/spawn-env", () => ({ findOnPath: () => null }));

import { runCliListing } from "./cli-list";
import { hasLocalSession } from "./index";
import { StoreUnavailable } from "./types";

describe("runCliListing", () => {
  it("reports a CLI that is not installed as unavailable, not as an empty listing", async () => {
    await expect(runCliListing("devin", ["list"], "/tmp")).rejects.toBeInstanceOf(StoreUnavailable);
  });
});

describe("hasLocalSession", () => {
  // null keeps "Continue last" offered with a caveat; false would hide it for nothing
  it("is unknown (null) when the CLI's listing cannot run", async () => {
    expect(await hasLocalSession("devin", "/tmp")).toBeNull();
  });

  it("is unknown (null) for a CLI with no adapter", async () => {
    expect(await hasLocalSession("amp", "/tmp")).toBeNull();
  });
});
