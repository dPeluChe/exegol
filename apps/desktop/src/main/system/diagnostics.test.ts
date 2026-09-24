import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({ app: { getPath: () => "/tmp", isPackaged: false } }));

import { redact, tailFile } from "./diagnostics";

describe("redact", () => {
  const home = "/Users/someone";

  it("hides the home directory", () => {
    expect(redact("cwd: /Users/someone/code/app", home)).toBe("cwd: ~/<path>");
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

  it("reduces spawn commands to binary + flags and drops task text", () => {
    const line =
      '[AgentManager] Spawning: {"fullCommand":"claude --settings /Users/someone/.exegol/hooks/a.json \'fix auth\'","taskDescription":"refactor the billing module"}';
    const out = redact(line, home);
    expect(out).toContain('"fullCommand":"claude --settings <args>"');
    expect(out).not.toContain("billing");
    expect(out).not.toContain("fix auth");
  });

  it("drops raw agent output carried by status lines", () => {
    const line =
      "2026-09-24T10:00:00Z [INFO] [AgentCallback] Status change: abc (claude-code) → running [const secret = loadClientData()]";
    const out = redact(line, home);
    expect(out).toContain("→ running [step redacted]");
    expect(out).not.toContain("loadClientData");
  });

  it("makes paths generic: folder names name the user and their clients", () => {
    const out = redact(
      "cwd /Users/someone/Data/PROJECTS/acme-client/app and /Users/other/x and /Volumes/Clients/acme, keep ~/.exegol/logs",
      home,
    );
    expect(out).not.toMatch(/someone|acme|other|Clients/);
    expect(out).toContain("~/.exegol/logs");
  });

  it("covers more credential shapes", () => {
    const out = redact(
      [
        "aws AKIAABCDEFGHIJKLMNOP",
        "jwt eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N",
        "-----BEGIN RSA PRIVATE KEY-----\nMIIEpAIBAAKCAQEA\n-----END RSA PRIVATE KEY-----",
        "url https://user:hunter2@example.com/path?sig=abcdef",
        "export OPENAI_KEY=abcd1234",
        "mail me@example.org from 10.0.0.12",
      ].join("\n"),
      home,
    );
    for (const secret of [
      "ABCDEFGHIJKLMNOP",
      "dozjgNryP4J3jVmNHl0w5N",
      "MIIEpAIBAAKCAQEA",
      "hunter2",
      "sig=abcdef",
      "example.com",
      "abcd1234",
      "me@example.org",
      "10.0.0.12",
    ]) {
      expect(out).not.toContain(secret);
    }
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
