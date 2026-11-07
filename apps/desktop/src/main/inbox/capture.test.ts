import Database from "libsql";
import { beforeEach, describe, expect, it } from "vitest";
import { runMigrations } from "../db/migrations";
import { listMessages } from "../db/queries/inbox";
import { capture } from "./capture";

let db: Database.Database;
const none = { title: null, url: null, text: null, note: null };

beforeEach(() => {
  db = new Database(":memory:");
  runMigrations(db);
});

describe("capture", () => {
  it("files a thread to review, written by the outside, with the person's line first", () => {
    const thread = capture(
      db,
      { scope: "personal" },
      { ...none, url: "https://a.dev/post", note: "for the landing" },
    );
    expect(thread).toMatchObject({ kind: "capture", title: "a.dev", url: "https://a.dev/post" });
    const [message] = listMessages(db, thread.id);
    expect(message).toMatchObject({
      authorKind: "external",
      body: "for the landing\n\nhttps://a.dev/post",
    });
  });

  it("refuses an empty capture and keeps a non-http url out", () => {
    expect(() => capture(db, { scope: "personal" }, none)).toThrow("Nothing to capture");
    expect(() => capture(db, { scope: "personal" }, { ...none, url: "file:///etc" })).toThrow();
  });
});
