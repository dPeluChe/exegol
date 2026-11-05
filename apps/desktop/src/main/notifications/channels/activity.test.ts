import Database from "libsql";
import { beforeEach, describe, expect, it } from "vitest";
import { runMigrations } from "../../db/migrations";
import { listActivities } from "../../db/queries/activities";
import { activityChannel, setActivityChannelDb } from "./activity";

describe("activityChannel", () => {
  let db: Database.Database;
  beforeEach(() => {
    db = new Database(":memory:");
    runMigrations(db);
    db.prepare("INSERT INTO projects (id, name, path) VALUES ('p1', 'One', '/a')").run();
    setActivityChannelDb(db);
  });

  it("feeds warnings with no project to every project, and leaves agent events out", () => {
    activityChannel.deliver({ type: "budget:warning", title: "Limit", body: "$8 of $10", at: 1 });
    activityChannel.deliver({ type: "agent:attention", title: "Question", agentId: "a", at: 1 });

    expect(listActivities(db, { projectId: "p1" }).map((a) => a.description)).toEqual([
      "Limit: $8 of $10",
    ]);
  });
});
