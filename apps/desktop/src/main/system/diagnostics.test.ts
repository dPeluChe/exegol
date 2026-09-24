import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({ app: { getPath: () => "/tmp", isPackaged: false } }));

import { redact, tailFile } from "./diagnostics";

describe("redact", () => {
  const home = "/Users/someone";

  it("hides the home directory", () => {
    expect(redact("cwd: /Users/someone/code/app", home)).toBe("cwd: ~/code/app");
  });

  it("hides API keys and tokens", () => {
    const out = redact(
      [
        "ANTHROPIC_API_KEY=sk-ant-api03-abcdefghijklmnop",
        "openai sk-proj-1234567890abcdefXYZ",
        "gh ghp_abcdefghijklmnopqrstuvwxyz123456",
        "github_pat_11ABCDEFG0123456789_abcdef",
        "slack xoxb-1234567890-abcdefghij",
        "google AIzaSyA1234567890abcdefghijklmnopqrstu",
        "Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.payload.sig",
        'EXEGOL_MCP_TOKEN="a1b2c3d4e5f6g7h8"',
        '{"apiKey":"zzzzzzzzzzzz"}',
      ].join("\n"),
      home,
    );
    for (const secret of [
      "abcdefghijklmnop",
      "1234567890abcdefXYZ",
      "abcdefghijklmnopqrstuvwxyz123456",
      "0123456789_abcdef",
      "1234567890-abcdefghij",
      "SyA1234567890",
      "eyJhbGciOiJIUzI1NiJ9",
      "a1b2c3d4e5f6g7h8",
      "zzzzzzzzzzzz",
    ]) {
      expect(out).not.toContain(secret);
    }
  });

  it("drops prompt text from spawn commands and task descriptions but keeps the CLI and flags", () => {
    const line =
      '[AgentManager] Spawning: {"fullCommand":"claude --settings /Users/someone/.exegol/hooks/a.json \'refactor the billing module so invoices round up\'","taskDescription":"refactor the billing module"}';
    const out = redact(line, home);
    expect(out).toContain("claude --settings ~/.exegol/hooks/a.json");
    expect(out).not.toContain("billing");
  });

  it("leaves ordinary log lines alone", () => {
    const line = "[Reattach] OK — reattached geNk_M4TPMevYkWSN4dCG (claude-code), PTY alive";
    expect(redact(line, home)).toBe(line);
  });
});

describe("tailFile", () => {
  it("returns the last lines, dropping a line cut by a partial read", () => {
    const dir = mkdtempSync(join(tmpdir(), "exegol-diag-"));
    const file = join(dir, "x.log");
    writeFileSync(file, Array.from({ length: 50 }, (_, i) => `line ${i}`).join("\n"));
    expect(tailFile(file, 3)).toBe("line 47\nline 48\nline 49");
    expect(tailFile(file, 100, 20).split("\n")[0]).toMatch(/^line \d+$/);
    expect(tailFile(join(dir, "missing.log"), 5)).toBe("");
  });
});
