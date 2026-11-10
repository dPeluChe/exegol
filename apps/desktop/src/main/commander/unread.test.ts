import Database from "libsql";
import { beforeEach, expect, it, vi } from "vitest";
import { runMigrations } from "../db/migrations";
import { setJsonSetting } from "../db/queries/settings";
import {
  commanderUnread,
  markCommanderRead,
  noteCommanderTurn,
  resetCommanderTurn,
} from "./unread";

const broadcast = vi.hoisted(() => vi.fn());
vi.mock("../lib/event-bus", () => ({ broadcast }));

let db: Database.Database;
const commander = { projectId: "home" };

beforeEach(() => {
  db = new Database(":memory:");
  runMigrations(db);
  setJsonSetting(db, "commander_project_id", "home");
  resetCommanderTurn();
  broadcast.mockClear();
});

it("counts each ended turn once, from the start of the first one not read", () => {
  noteCommanderTurn(db, commander, "turn_started", 10_000);
  noteCommanderTurn(db, commander, "finished", 15_000);
  noteCommanderTurn(db, commander, "finished", 15_100);
  noteCommanderTurn(db, commander, "turn_started", 60_000);
  noteCommanderTurn(db, commander, "finished", 70_000);
  expect(commanderUnread(db)).toEqual({ count: 2, since: 10 });
  expect(broadcast).toHaveBeenLastCalledWith("commander:unread", { count: 2, since: 10 });
});

it("leaves the turns of other sessions out", () => {
  noteCommanderTurn(db, { projectId: "p1" }, "finished", 5_000);
  expect(commanderUnread(db).count).toBe(0);
  expect(broadcast).not.toHaveBeenCalled();
});

it("a read starts the count again and tells the windows only when it changed", () => {
  noteCommanderTurn(db, commander, "finished", 5_000);
  broadcast.mockClear();
  markCommanderRead(db);
  markCommanderRead(db);
  expect(broadcast).toHaveBeenCalledTimes(1);
  noteCommanderTurn(db, commander, "turn_started", 90_000);
  noteCommanderTurn(db, commander, "finished", 95_000);
  expect(commanderUnread(db)).toEqual({ count: 1, since: 90 });
});
