import { type Colab, colabIdsOf, type InboxThread, inboxCountsOn } from "@exegol/shared";

/** `to`: the member project a colab thread is for, null for the whole colab */
export type InboxTarget =
  | { kind: "project" }
  | { kind: "personal" }
  | { kind: "colab"; id: string; to: string | null };

export interface InboxTab {
  key: string;
  label: string;
  target: InboxTarget;
  threads: InboxThread[];
}

/** One inbox per tab: the project's own, each colab it is in, then Personal */
export function inboxTabs(
  threads: InboxThread[],
  projectId: string,
  projectName: string,
  colabs: Colab[],
): InboxTab[] {
  return [
    {
      key: "project",
      label: projectName,
      target: { kind: "project" },
      threads: threads.filter((t) => t.scope === "project" && t.scopeId === projectId),
    },
    ...colabs.map((c) => ({
      key: c.id,
      label: c.name,
      target: { kind: "colab" as const, id: c.id, to: null },
      threads: threads.filter((t) => t.scope === "colab" && t.scopeId === c.id),
    })),
    {
      key: "personal",
      label: "Personal",
      target: { kind: "personal" },
      threads: threads.filter((t) => t.scope === "personal"),
    },
  ];
}

/** The picked tab while it exists, else the first inbox with something in it */
export function shownTab(tabs: InboxTab[], picked: string | null): InboxTab {
  const tab = tabs.find((t) => t.key === picked) ?? tabs.find((t) => t.threads.length > 0);
  return tab ?? (tabs[0] as InboxTab);
}

export const waitingOn = (threads: InboxThread[], colabs: Colab[], projectId: string) => {
  const ids = colabIdsOf(colabs, projectId);
  return threads.filter((t) => inboxCountsOn(t, projectId, ids)).length;
};
