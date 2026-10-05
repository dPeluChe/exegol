import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";

// A private log dir: other test files rotate the shared one in parallel
vi.mock("node:os", async (orig) => {
  const os = await orig<typeof import("node:os")>();
  const dir = `${os.tmpdir()}/exegol-logger-${process.pid}`;
  return { ...os, tmpdir: () => dir };
});

const { flushLogSync, logger, LOG_DIR } = await import("./logger");
const read = () => readFileSync(join(LOG_DIR, "exegol.log"), "utf-8");

afterAll(() => rmSync(join(LOG_DIR, ".."), { recursive: true, force: true }));

describe("logger file writes", () => {
  it("queues lines off the call and keeps their order across timed and sync flushes", async () => {
    expect(LOG_DIR).toContain(`exegol-logger-${process.pid}`);
    logger.debug("one");
    logger.debug("two");
    expect(read()).not.toContain("one");

    await new Promise((r) => setTimeout(r, 120));
    expect(read()).toContain("two");
    logger.debug("three");
    flushLogSync();
    flushLogSync();

    const lines = read()
      .split("\n")
      .filter((l) => l.includes("[DEBUG]"))
      .map((l) => l.slice(l.indexOf("]") + 2));
    expect(lines).toEqual(["one", "two", "three"]);
    expect(read().startsWith("--- Session started")).toBe(true);
  });
});
