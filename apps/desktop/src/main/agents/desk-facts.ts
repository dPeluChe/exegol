import type { DeskFacts } from "@exegol/shared";
import type Database from "libsql";
import { listLiveAgentFolderRows } from "../db/queries";
import { listAgentLinkPairs } from "../db/queries/agent-links";
import { readGitStatus } from "../ipc/procedures/git-status";
import { mapWithConcurrency } from "../lib/concurrency";
import { listDevServers } from "../system/dev-servers";

const GIT_READS = 4;

/** Badges of the Company desks. Git and ports come from the caches their own panels share */
export async function deskFacts(db: Database.Database): Promise<Record<string, DeskFacts>> {
  const rows = listLiveAgentFolderRows(db);
  const folders = [...new Set(rows.flatMap((r) => (r.cwd ? [r.cwd] : [])))];
  const changed = new Map<string, number | null>();
  await mapWithConcurrency(folders, GIT_READS, async (cwd) => {
    const files = await readGitStatus(cwd).catch(() => null);
    changed.set(cwd, files ? files.length : null);
  });
  const portOf = new Map<string, number>();
  for (const server of await listDevServers(db).catch(() => [])) {
    const port = server.ports[0];
    if (server.agent && port && !portOf.has(server.agent.id)) portOf.set(server.agent.id, port);
  }
  const linked = new Map<string, string[]>();
  for (const { from, to } of listAgentLinkPairs(db)) {
    linked.set(from, [...(linked.get(from) ?? []), to]);
    linked.set(to, [...(linked.get(to) ?? []), from]);
  }
  return Object.fromEntries(
    rows.map((r) => [
      r.id,
      {
        changedFiles: r.cwd ? (changed.get(r.cwd) ?? null) : null,
        port: portOf.get(r.id) ?? null,
        linkedTo: linked.get(r.id) ?? [],
      },
    ]),
  );
}
