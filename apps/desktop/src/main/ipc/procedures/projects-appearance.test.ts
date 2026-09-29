import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../agents/spawn-env", () => ({ coreRust: null }));

const { projectRouter } = await import("./projects");
const caller = projectRouter.createCaller({} as never);

function repoWithIcon() {
  const dir = mkdtempSync(join(tmpdir(), "exegol-icons-"));
  mkdirSync(join(dir, "public"));
  // 1x1 transparent PNG
  writeFileSync(
    join(dir, "public", "favicon.png"),
    Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
      "base64",
    ),
  );
  return dir;
}

describe("projects.detectIconsAt (Add project, before the project exists)", () => {
  it("finds the icons of the picked folder", async () => {
    const dir = repoWithIcon();
    const found = await caller.detectIconsAt({ path: dir });
    expect(found.map((f) => f.rel)).toContain("public/favicon.png");
  });

  it("returns nothing for a relative, missing or non-directory path", async () => {
    const dir = repoWithIcon();
    expect(await caller.detectIconsAt({ path: "public" })).toEqual([]);
    expect(await caller.detectIconsAt({ path: join(dir, "nope") })).toEqual([]);
    expect(await caller.detectIconsAt({ path: join(dir, "public", "favicon.png") })).toEqual([]);
  });
});
