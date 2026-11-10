import type { SpeechFeedback, SpeechFeedbackEntry } from "@exegol/shared";
import type Database from "libsql";

export const SPOKEN_MAX_CHARS = 4_000;

type NewSpeechFeedback = Omit<SpeechFeedbackEntry, "id" | "at">;

const COLUMNS = `id, at, agent_id AS agentId, turn_id AS turnId, rating, note, voice, speed, model`;

/** One record per turn: saving again replaces the mark, the note and how it was read */
export function saveSpeechFeedback(db: Database.Database, entry: NewSpeechFeedback): void {
  db.prepare(
    `INSERT INTO speech_feedback (at, agent_id, turn_id, rating, note, voice, speed, model, spoken)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (turn_id) DO UPDATE SET
       at = excluded.at, agent_id = excluded.agent_id, rating = excluded.rating,
       note = excluded.note, voice = excluded.voice, speed = excluded.speed,
       model = excluded.model, spoken = excluded.spoken`,
  ).run(
    Date.now(),
    entry.agentId,
    entry.turnId,
    entry.rating,
    entry.note,
    entry.voice,
    entry.speed,
    entry.model,
    entry.spoken.slice(0, SPOKEN_MAX_CHARS),
  );
}

export function speechFeedbackFor(db: Database.Database, turnIds: string[]): SpeechFeedback[] {
  if (turnIds.length === 0) return [];
  return db
    .prepare(
      `SELECT ${COLUMNS} FROM speech_feedback
       WHERE turn_id IN (${turnIds.map(() => "?").join(", ")})`,
    )
    .all(...turnIds) as SpeechFeedback[];
}

export function deleteSpeechFeedback(db: Database.Database, turnId: string): boolean {
  return db.prepare("DELETE FROM speech_feedback WHERE turn_id = ?").run(turnId).changes > 0;
}

/** Newest first */
export function listSpeechFeedback(db: Database.Database, limit: number): SpeechFeedbackEntry[] {
  return db
    .prepare(`SELECT ${COLUMNS}, spoken FROM speech_feedback ORDER BY at DESC, id DESC LIMIT ?`)
    .all(limit) as SpeechFeedbackEntry[];
}
