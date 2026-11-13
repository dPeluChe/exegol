import type { Colab } from "@exegol/shared";
import type Database from "libsql";
import { listColabs } from "../db/queries/colabs";
import { countActiveThreads } from "../db/queries/inbox";
import { INDEX_FILE, loadNotes, noteIds } from "../notes/files";
import { notesFolder } from "../notes/folders";

const MAX_COLABS = 3;
const MAX_TITLES = 20;

/** Names and purpose come from the person; a colab's notes only as a count, never their text */
async function colabLine(db: Database.Database, colab: Colab, projectId: string) {
  const others = colab.members
    .filter((m) => m.projectId !== projectId)
    .map((m) =>
      [
        m.repo ? `${m.projectName} (${m.repo})` : m.projectName,
        m.role,
        m.main ? "main dev, makes the changes" : "user dev, uses it and reports",
      ]
        .filter(Boolean)
        .join(", "),
    );
  const mine = colab.members.filter((m) => m.projectId === projectId);
  const own = mine.some((m) => m.main)
    ? " This project is its main dev: the changes its threads ask for are made here."
    : mine.length > 0
      ? " This project is a user dev: report what the main dev should change in a colab thread."
      : "";
  const purpose = colab.purpose ? ` Purpose: ${colab.purpose}` : "";
  const folder = notesFolder(db, { scope: "colab", colabId: colab.id });
  const count = folder ? (await noteIds(folder.dir)).length : 0;
  const notes = count > 0 ? ` Its notes: ${count}, see note_list scope colab.` : "";
  return (
    `You are in colab ${JSON.stringify(colab.name)} with ${others.join("; ") || "no one yet"}.` +
    `${own}${purpose} Tell them what they should know with inbox_post target colab.${notes}`
  );
}

async function notesLine(db: Database.Database, projectId: string): Promise<string> {
  const folder = notesFolder(db, { scope: "project", projectId });
  const notes = folder ? await loadNotes(folder.dir) : [];
  if (!folder || notes.length === 0) return "";
  const titles = notes.slice(0, MAX_TITLES).map((n) => JSON.stringify(n.title));
  return (
    `This project's notes: ${notes.length} (${folder.shown}/, index in ${INDEX_FILE}). ` +
    `Newest first: ${titles.join("; ")}`
  );
}

/** What a starting session is told, resume and quick launch included: a prompt would start a turn */
export async function sessionLine(db: Database.Database, projectId: string): Promise<string> {
  const waiting = countActiveThreads(db, projectId);
  const threads = waiting === 1 ? "1 thread" : `${waiting} threads`;
  const colabs = listColabs(db, projectId).slice(0, MAX_COLABS);
  const lines = await Promise.all([
    notesLine(db, projectId),
    ...colabs.map((c) => colabLine(db, c, projectId)),
  ]);
  return [
    waiting > 0 ? `Inbox: ${threads} waiting for this project. See them with inbox_list.` : "",
    ...lines,
  ]
    .filter(Boolean)
    .join("\n");
}
