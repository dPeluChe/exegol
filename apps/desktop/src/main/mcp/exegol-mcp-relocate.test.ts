import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { swapRoot } from "../system/app-location";

const home = vi.hoisted(() => {
  const { mkdtempSync } = require("node:fs") as typeof import("node:fs");
  const { tmpdir } = require("node:os") as typeof import("node:os");
  const { join } = require("node:path") as typeof import("node:path");
  return mkdtempSync(join(tmpdir(), "exegol-home-"));
});
vi.mock("node:os", async (orig) => ({
  ...(await orig<typeof import("node:os")>()),
  homedir: () => home,
}));

const { relocateMcpConfigs } = await import("./exegol-mcp-config");

const OLD = "/Volumes/E/Exegol.app";
const NEW = "/Applications/Exegol.app";
const swap = <T>(v: T): T => swapRoot(v, { from: OLD, to: NEW });
const read = (p: string) => JSON.parse(readFileSync(p, "utf-8"));

describe("relocateMcpConfigs", () => {
  it("moves Exegol's entries only: per-agent file, project file, codex block", () => {
    mkdirSync(join(home, ".exegol", "mcp"), { recursive: true });
    const agentFile = join(home, ".exegol", "mcp", "a1.json");
    writeFileSync(
      agentFile,
      JSON.stringify({ mcpServers: { exegol: { command: `${OLD}/Contents/MacOS/Exegol` } } }),
    );
    const repo = mkdtempSync(join(home, "repo-"));
    writeFileSync(
      join(repo, ".mcp.json"),
      JSON.stringify({
        mcpServers: {
          exegol: { command: `${OLD}/Contents/MacOS/Exegol`, args: [`${OLD}/shim.js`] },
          mine: { command: `${OLD}/Contents/MacOS/Exegol` },
        },
      }),
    );
    mkdirSync(join(home, ".codex"));
    const codex = join(home, ".codex", "config.toml");
    const block = [
      "# >>> exegol managed — do not edit >>>",
      `command = "${OLD}/Contents/MacOS/Exegol"`,
      "# <<< exegol managed <<<",
    ].join("\n");
    writeFileSync(codex, `other = "${OLD}/x"\n\n${block}\n`);

    expect(relocateMcpConfigs([repo, repo], swap)).toBe(3);
    expect(read(agentFile).mcpServers.exegol.command).toBe(`${NEW}/Contents/MacOS/Exegol`);
    const project = read(join(repo, ".mcp.json")).mcpServers;
    expect(project.exegol.args).toEqual([`${NEW}/shim.js`]);
    expect(project.mine.command).toBe(`${OLD}/Contents/MacOS/Exegol`);
    const toml = readFileSync(codex, "utf-8");
    expect(toml).toContain(`other = "${OLD}/x"`);
    expect(toml).toContain(`command = "${NEW}/Contents/MacOS/Exegol"`);
    expect(relocateMcpConfigs([repo], swap)).toBe(0);
  });
});
