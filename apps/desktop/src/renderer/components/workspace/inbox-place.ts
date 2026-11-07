import type { InboxThread } from "@exegol/shared";
import type { ProjectMeta } from "../common/ProjectChip";

export const inboxPlace = (thread: InboxThread, meta: ReadonlyMap<string, ProjectMeta>) =>
  thread.scope === "personal"
    ? "Personal"
    : (meta.get(thread.scopeId ?? "")?.name ?? thread.scopeId ?? "");
