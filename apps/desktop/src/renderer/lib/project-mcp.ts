import type { ClaudeMcpServerInfo } from "@exegol/shared";

export function toggleServer(selected: string[], name: string, on: boolean): string[] {
  return on ? [...selected, name] : selected.filter((n) => n !== name);
}

/** "3 of 5 load, 2 start a process in every session" for the choice shown */
export function mcpLoadSummary(servers: ClaudeMcpServerInfo[], selected: string[] | null): string {
  const loaded = selected === null ? servers : servers.filter((s) => selected.includes(s.name));
  const processes = loaded.filter((s) => s.transport === "stdio").length;
  const each = processes === 1 ? "1 starts" : `${processes} start`;
  return `${loaded.length} of ${servers.length} load, ${each} a process in every session`;
}
