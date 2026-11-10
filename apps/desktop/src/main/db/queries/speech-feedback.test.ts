import Database from "libsql";
import { beforeEach, describe, expect, it } from "vitest";
import { runMigrations } from "../migrations";
import {
  deleteSpeechFeedback,
  listSpeechFeedback,
  SPOKEN_MAX_CHARS,
  saveSpeechFeedback,
  speechFeedbackFor,
} from "./speech-feedback";

let db: Database.Database;
beforeEach(() => {
  db = new Database(":memory:");
  runMigrations(db);
});

const entry = (turnId: string, over: Partial<Parameters<typeof saveSpeechFeedback>[1]> = {}) => ({
  agentId: "a1",
  turnId,
  rating: "bad" as const,
  note: "read #37 wrong",
  voice: "em_alex",
  speed: 1,
  model: "kokoro",
  spoken: "Issue #37.",
  ...over,
});

describe("speech feedback", () => {
  it("keeps one record per turn, the last save wins", () => {
    saveSpeechFeedback(db, entry("t1"));
    saveSpeechFeedback(db, entry("t1", { rating: "good", note: null, speed: 1.2 }));
    saveSpeechFeedback(db, entry("t9", { agentId: "a2" }));
    const rows = speechFeedbackFor(db, "a1");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ turnId: "t1", rating: "good", note: null, speed: 1.2 });
    expect(rows[0]).not.toHaveProperty("spoken");
  });

  it("lists newest first with the spoken text, capped", () => {
    saveSpeechFeedback(db, entry("t1", { spoken: "x".repeat(SPOKEN_MAX_CHARS + 50) }));
    saveSpeechFeedback(db, entry("t2"));
    const list = listSpeechFeedback(db, 200);
    expect(list.map((r) => r.turnId)).toEqual(["t2", "t1"]);
    expect(list[1]?.spoken).toHaveLength(SPOKEN_MAX_CHARS);
  });

  it("removes one", () => {
    saveSpeechFeedback(db, entry("t1"));
    expect(deleteSpeechFeedback(db, "t1")).toBe(true);
    expect(deleteSpeechFeedback(db, "t1")).toBe(false);
    expect(speechFeedbackFor(db, "a1")).toEqual([]);
  });
});
