import { describe, expect, it } from "vitest";
import { withCodexExegolBlock } from "./exegol-mcp-config";

const START = "# >>> exegol managed — do not edit >>>";
const END = "# <<< exegol managed <<<";
const block = [START, "[mcp_servers.exegol]", 'command = "/A"', END].join("\n");
const tables = (s: string) => s.match(/^\[mcp_servers\.exegol\]/gm)?.length ?? 0;

describe("withCodexExegolBlock", () => {
  it("adds the block to an empty or unrelated config, and is idempotent", () => {
    expect(withCodexExegolBlock("", block)).toBe(`${block}\n`);
    const once = withCodexExegolBlock('model = "o3"\n', block);
    expect(once).toBe(`model = "o3"\n\n${block}\n`);
    expect(withCodexExegolBlock(once, block)).toBe(once);
  });

  it("keeps one block when a stray end marker sits before the start (the Codex app rewrite)", () => {
    const broken = [
      "[mcp_servers.pencil]",
      'command = "/P"',
      "",
      "[marketplaces.x]",
      'source = "local"',
      END,
      "",
      block,
      "",
      block,
    ].join("\n");
    const out = withCodexExegolBlock(broken, block);
    expect(tables(out)).toBe(1);
    expect(out).toContain("[mcp_servers.pencil]");
    expect(out).toContain('[marketplaces.x]\nsource = "local"');
    expect(out.endsWith(`${block}\n`)).toBe(true);
  });

  it("drops a moved exegol table and its env subtable, keeping the tables around them", () => {
    const moved = [
      "[mcp_servers.pencil]",
      'command = "/P"',
      "",
      "[mcp_servers.exegol]",
      'command = "/old"',
      "",
      "[mcp_servers.exegol.env]",
      'ELECTRON_RUN_AS_NODE = "1"',
      "",
      "[mcp_servers.tinyfish]",
      'url = "https://t"',
    ].join("\n");
    const out = withCodexExegolBlock(moved, block);
    expect(tables(out)).toBe(1);
    expect(out).not.toContain("/old");
    expect(out).not.toContain("[mcp_servers.exegol.env]");
    expect(out).toContain('[mcp_servers.tinyfish]\nurl = "https://t"');
  });

  it("leaves a server whose name only starts with exegol alone", () => {
    const other = '[mcp_servers.exegol-docs]\ncommand = "/D"\n';
    expect(withCodexExegolBlock(other, block)).toContain("[mcp_servers.exegol-docs]");
  });
});
