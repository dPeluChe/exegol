import type { Colab } from "@exegol/shared";
import type Database from "libsql";
import { listColabs } from "../db/queries/colabs";
import { countActiveThreads } from "../db/queries/inbox";

const MAX_COLABS = 3;

/** Names and purpose come from the person, never from another session */
function colabLine(colab: Colab, projectId: string): string {
  const others = colab.members
    .filter((m) => m.projectId !== projectId)
    .map((m) =>
      [m.repo ? `${m.projectName} (${m.repo})` : m.projectName, m.role].filter(Boolean).join(", "),
    );
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
    ...listColabs(db, projectId)
      .slice(0, MAX_COLABS)
      .map((c) => colabLine(c, projectId)),
  ]
    .filter(Boolean)
    .join("\n");
}
