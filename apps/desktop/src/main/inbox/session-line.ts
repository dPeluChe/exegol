import type { Colab } from "@exegol/shared";
import type Database from "libsql";
import { colabsOfProject } from "../db/queries/colabs";
import { countActiveThreads } from "../db/queries/inbox";
import { getProject } from "../db/queries/projects";

const MAX_COLABS = 3;

/** Names and purpose come from the person, never from another session */
function colabLine(db: Database.Database, colab: Colab, projectId: string): string {
  const others = colab.members
    .filter((m) => m.projectId !== projectId)
    .map((m) => {
      const name = getProject(db, m.projectId)?.name ?? m.projectId;
      return [m.repo ? `${name} (${m.repo})` : name, m.role].filter(Boolean).join(", ");
    });
  const purpose = colab.purpose ? ` Purpose: ${colab.purpose}` : "";
  return (
    `You are in colab ${JSON.stringify(colab.name)} with ${others.join("; ") || "no one yet"}.` +
    `${purpose} Tell them what they should know with inbox_post target colab.`
  );
}

/** What a starting session is told, resume and quick launch included: a prompt would start a turn */
export function sessionLine(db: Database.Database, projectId: string): string {
  const waiting = countActiveThreads(db, projectId);
  const threads = waiting === 1 ? "1 thread" : `${waiting} threads`;
  return [
    waiting > 0 ? `Inbox: ${threads} waiting for this project. See them with inbox_list.` : "",
    ...colabsOfProject(db, projectId)
      .slice(0, MAX_COLABS)
      .map((c) => colabLine(db, c, projectId)),
  ]
    .filter(Boolean)
    .join("\n");
}
