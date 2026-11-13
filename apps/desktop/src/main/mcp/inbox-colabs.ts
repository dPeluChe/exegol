import { type Colab, type ColabMember, type InboxThread, memberRole } from "@exegol/shared";
import { InboxError, type InboxTarget } from "../inbox/threads";
import { sameName as same, text } from "../lib/names";

const projectNames = (members: ColabMember[]) => [...new Set(members.map((m) => m.projectName))];

const described = (colabs: Colab[]) =>
  colabs.map((c) => `${c.name} (${projectNames(c.members).join(", ")})`).join("; ") || "none";

/** By its name, by the name of another member when that says which one, or the only one */
function colabFor(colabs: Colab[], projectId: string, name: string) {
  if (!name && colabs.length === 1) return { colab: colabs[0] as Colab, member: null };
  const colab = colabs.find((c) => same(c.name, name));
  if (colab) return { colab, member: null };
  const through = colabs.flatMap((c) =>
    c.members
      .filter((m) => m.projectId !== projectId && same(m.projectName, name))
      .slice(0, 1)
      .map((member) => ({ colab: c, member })),
  );
  if (through.length === 1) return through[0] as (typeof through)[number];
  const what = name ? `No colab named ${JSON.stringify(name)} here` : "Say which colab";
  throw new InboxError(`${what}. Yours: ${described(colabs)}`);
}

/** `colabs`: those the project is in */
export const colabNamed = (colabs: Colab[], projectId: string, name: unknown): Colab =>
  colabFor(colabs, projectId, text(name)).colab;

export function colabTarget(
  colabs: Colab[],
  args: Record<string, unknown>,
  projectId: string,
): InboxTarget {
  const { colab, member } = colabFor(colabs, projectId, text(args.colab));
  const wanted = text(args.to_project);
  if (!wanted) return { scope: "colab", colabId: colab.id, toProject: member?.projectId ?? null };
  const to = colab.members.find((m) => same(m.projectName, wanted));
  if (!to) {
    const names = projectNames(colab.members).join(", ");
    throw new InboxError(`${JSON.stringify(wanted)} is not in ${colab.name}. Members: ${names}`);
  }
  return { scope: "colab", colabId: colab.id, toProject: to.projectId };
}

export const colabView = (colab: Colab, projectId: string) => ({
  colab: colab.name,
  purpose: colab.purpose,
  members: colab.members.map((m) => ({
    project: m.projectName,
    ...(m.repo && { repo: m.repo }),
    role: memberRole(m).label,
    ...(m.role && { note: m.role }),
    ...(m.projectId === projectId && { you: true }),
  })),
});

/** Where a thread sits, in the names an agent can pass back */
export function placeOf(thread: InboxThread, colabs: Colab[]) {
  if (thread.scope !== "colab") return {};
  const colab = colabs.find((c) => c.id === thread.scopeId);
  const to = colab?.members.find((m) => m.projectId === thread.toProject);
  return { colab: colab?.name ?? null, ...(to && { to_project: to.projectName }) };
}

/** Who finds a new thread, so the session that posted it knows what happens next */
export function seenBy(thread: InboxThread, colabs: Colab[], projectId: string): string {
  if (thread.scope === "personal") return "The person only, in their Inbox";
  if (thread.scope === "project") return "Later sessions of this project, and the person";
  const colab = colabs.find((c) => c.id === thread.scopeId);
  const others = colab?.members.filter((m) => m.projectId !== projectId) ?? [];
  const to = others.find((m) => m.projectId === thread.toProject);
  const names = projectNames(others).join(", ");
  return to
    ? `It counts on ${to.projectName}: its sessions see it at their next start or inbox_list. The person too`
    : `Sessions of ${names || "the other members"} at their next start or inbox_list, and the person`;
}
