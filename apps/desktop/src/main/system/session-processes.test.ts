import { describe, expect, it } from "vitest";
import type { ProcRow } from "./process-table";
import { sessionProcesses } from "./session-processes";

const session = {
  id: "a1",
  pid: 100,
  alias: "nova",
  taskDescription: null,
  cliType: "claude-code",
  projectId: "p1",
  projectName: "Demo",
};

function row(pid: number, ppid: number, args: string, rss = 1000): ProcRow {
  return { pid, ppid, args, rss, cpu: 1, tty: "??" };
}

const rows: ProcRow[] = [
  row(100, 1, "-zsh"),
  row(101, 100, "node /opt/bin/claude --mcp-config /x.json", 300_000),
  row(102, 101, "/App/Electron /App/exegol-mcp-shim-bin.js", 50_000),
  row(103, 101, "npm exec @acme/db-server --token=secret", 40_000),
  row(104, 103, "node /cache/@acme/db-server/index.js", 60_000),
  row(105, 101, "/bin/bash -c ls", 2_000),
  row(900, 1, "node /other/@acme/db-server/index.js", 70_000),
];

describe("sessionProcesses", () => {
  const known = [{ name: "db", hint: "@acme/db-server" }];
  const out = sessionProcesses(session, rows, known);
  const group = (kind: string, name: string) =>
    out.groups.find((g) => g.kind === kind && g.name === name);

  it("counts only the session's own processes", () => {
    expect(out.count).toBe(6);
    expect(out.rssKb).toBe(453_000);
  });

  it("names a known server and counts its children with it", () => {
    expect(group("mcp", "db")).toMatchObject({ count: 2, rssKb: 100_000 });
  });

  it("tells the bridge, the shell and the rest apart by program name only", () => {
    expect(group("bridge", "MCP bridge")?.count).toBe(1);
    expect(group("shell", "zsh")?.count).toBe(1);
    expect(group("other", "claude")?.rssKb).toBe(300_000);
    expect(group("other", "bash")?.count).toBe(1);
    expect(JSON.stringify(out)).not.toContain("secret");
  });

  it("is empty when the session's process is gone", () => {
    expect(sessionProcesses({ ...session, pid: 555 }, rows, known).count).toBe(0);
  });
});
