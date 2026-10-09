import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({ net: { fetch: vi.fn() } }));
vi.mock("../agents/spawn-env", () => ({ _getFullPath: () => "", commandOnPath: () => false }));
vi.mock("../lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn() } }));

import { parsePathHits } from "./cli-versions";

describe("parsePathHits", () => {
  it("splits Windows `where` CRLF output without keeping the \\r", () => {
    expect(
      parsePathHits("C:\\Users\\me\\AppData\\Roaming\\npm\\codex.cmd\r\nC:\\tools\\codex.exe\r\n"),
    ).toEqual(["C:\\Users\\me\\AppData\\Roaming\\npm\\codex.cmd", "C:\\tools\\codex.exe"]);
  });
  it("splits `which -a` output and drops repeats", () => {
    expect(
      parsePathHits("/opt/homebrew/bin/codex\n/usr/local/bin/codex\n/opt/homebrew/bin/codex\n"),
    ).toEqual(["/opt/homebrew/bin/codex", "/usr/local/bin/codex"]);
  });
});
