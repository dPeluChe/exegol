import type { DeskFacts } from "@exegol/shared";
import type Database from "libsql";
import { listLiveAgentFolderRows } from "../db/queries";
import { listAgentLinkPairs } from "../db/queries/agent-links";
import { readGitStatus } from "../ipc/procedures/git-status";
import { mapWithConcurrency } from "../lib/concurrency";
import { listAgentPorts } from "../system/dev-servers";

const GIT_READS = 4;

/** Badges of the Company desks. Git status comes from the cache its own panels share */
export async function deskFacts(db: Database.Database): Promise<Record<string, DeskFacts>> {
  const rows = listLiveAgentFolderRows(db);
  const folders = [...new Set(rows.flatMap((r) => (r.cwd ? [r.cwd] : [])))];
  const changed = new Map<string, number>();
  await mapWithConcurrency(folders, GIT_READS, async (cwd) => {
    const files = await readGitStatus(cwd).catch(() => null);
    if (files) changed.set(cwd, files.length);
  });
  const ports = await listAgentPorts(db).catch(() => new Map<string, number>());
  const linked = new Set(listAgentLinkPairs(db).flatMap((p) => [p.from, p.to]));
  return Object.fromEntries(
    rows.map((r) => [
      r.id,
      {
        changedFiles: r.cwd ? (changed.get(r.cwd) ?? null) : null,
        port: ports.get(r.id) ?? null,
        linked: linked.has(r.id),
      },
    ]),
  );
}
