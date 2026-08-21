import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

// The router pulls the whole main process in; only its SHAPE matters here.
vi.mock("electron", () => ({
  app: { getPath: () => "/tmp", isPackaged: false },
  ipcMain: { handle: vi.fn() },
}));

import { appRouter } from "../main/ipc/router";

/**
 * The preload allowlist is a SECOND list of every procedure, maintained by hand,
 * and a missing entry fails at runtime with no error the user can see: the call
 * is refused in the renderer, react-query reports no data, and the feature is
 * simply blank.
 *
 * Three procedures shipped dead that way in one session — `history.list`,
 * `agents.previewSpawn` and `agents.archive` — each the entire point of the
 * change that added it. Nothing else in the suite can catch it, because both
 * halves are individually correct.
 */
describe("preload capabilities allowlist", () => {
  // Mirrors the shape both live matchers use (`preload/index.ts`,
  // `main/ipc/capabilities.ts`): a router may be "*" for every procedure.
  const capabilities = JSON.parse(readFileSync(join(__dirname, "capabilities.json"), "utf-8")) as {
    trpc: Record<string, "*" | readonly string[]>;
  };

  const wildcardRouters = new Set(
    Object.entries(capabilities.trpc)
      .filter(([, procedures]) => procedures === "*")
      .map(([router]) => router),
  );
  const allowed = new Set(
    Object.entries(capabilities.trpc).flatMap(([router, procedures]) =>
      procedures === "*" ? [] : procedures.map((p) => `${router}.${p}`),
    ),
  );
  const isAllowed = (name: string) =>
    allowed.has(name) || wildcardRouters.has(name.split(".")[0] ?? "");
  const served = Object.keys(appRouter._def.procedures);

  it("exposes every procedure the router serves", () => {
    const missing = served.filter((name) => !isAllowed(name));
    expect(missing, `add these to preload/capabilities.json: ${missing.join(", ")}`).toEqual([]);
  });

  it("does not allow a procedure that no longer exists", () => {
    const servedSet = new Set(served);
    const stale = [...allowed].filter((name) => !servedSet.has(name));
    expect(stale, `remove these from preload/capabilities.json: ${stale.join(", ")}`).toEqual([]);
  });
});
