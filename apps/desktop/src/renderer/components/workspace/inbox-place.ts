import { type InboxThread, inboxProjectOf } from "@exegol/shared";
import type { ProjectMeta } from "../common/ProjectChip";

export const nameOf = (meta: ReadonlyMap<string, ProjectMeta>, id: string | null) =>
  id ? (meta.get(id)?.name ?? id) : "";

/** Who wrote a message: the person, a capture, or the name given for its session */
export const authorKindLabel = (kind: InboxThread["lastAuthorKind"], name: string) =>
  kind === "user" ? "You" : kind === "external" ? "Captured" : name || "Agent";

/** "Personal", the project, or "Landings > Irma" for a colab thread (the colab alone if for
 *  all), then the session it is for */
export function inboxPlace(
  thread: InboxThread,
  meta: ReadonlyMap<string, ProjectMeta>,
  colabNames: ReadonlyMap<string, string> = new Map(),
): string {
  if (thread.scope === "personal") return "Personal";
  const to = inboxProjectOf(thread);
  const colab = thread.scope === "colab" ? (colabNames.get(thread.scopeId ?? "") ?? "Colab") : "";
  const parts = [colab, nameOf(meta, to), to ? thread.toSession : null];
  return parts.filter(Boolean).join(" > ");
}
