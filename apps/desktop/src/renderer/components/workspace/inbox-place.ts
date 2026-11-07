import { type InboxThread, inboxProjectOf } from "@exegol/shared";
import type { ProjectMeta } from "../common/ProjectChip";

const nameOf = (meta: ReadonlyMap<string, ProjectMeta>, id: string | null) =>
  id ? (meta.get(id)?.name ?? id) : "";

/** "Personal", the project, or "Landings > Irma" for a colab thread (the colab alone if for all) */
export function inboxPlace(
  thread: InboxThread,
  meta: ReadonlyMap<string, ProjectMeta>,
  colabNames: ReadonlyMap<string, string> = new Map(),
): string {
  if (thread.scope === "personal") return "Personal";
  if (thread.scope === "project") return nameOf(meta, thread.scopeId);
  const colab = colabNames.get(thread.scopeId ?? "") ?? "Colab";
  const to = inboxProjectOf(thread);
  return to ? `${colab} > ${nameOf(meta, to)}` : colab;
}
