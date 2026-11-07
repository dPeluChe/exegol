import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { NOTE_BODY_MAX, NOTES_PER_FOLDER } from "@exegol/shared";
import Database from "libsql";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { runMigrations } from "../db/migrations";
import { addColabMember, createColab } from "../db/queries/colabs";
import { sessionLine } from "../inbox/session-line";
import { callNotesTool } from "../mcp/exegol-notes-tools";
import { INDEX_FILE, readNote, writeNote } from "./files";
import { notesFolder, notesRoot } from "./folders";

vi.mock("../mcp/exegol-protocol", async (original) => {
  const { join } = await import("node:path");
  const { tmpdir } = await import("node:os");
  return {
    ...(await original<typeof import("../mcp/exegol-protocol")>()),
    EXEGOL_DIR: join(tmpdir(), `exegol-notes-${process.pid}-${Date.now()}`),
  };
});

let db: Database.Database;
let colab: string;
const author = { session: "a-blue", cli: "claude-code", branch: null, commit: null };
const context = (agentId: string, projectId: string) =>
  ({ agentId, projectId, accessMode: "write" }) as Parameters<typeof callNotesTool>[3];
const call = (
  tool: Parameters<typeof callNotesTool>[1],
  args: object,
  agent = "a-blue",
  project = agent.slice(2),
) =>
  callNotesTool(db, tool, args as Record<string, unknown>, context(agent, project)) as Promise<
    Record<string, unknown>
  >;

beforeEach(async () => {
  await rm(notesRoot(), { recursive: true, force: true });
  db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  runMigrations(db);
  for (const [id, name] of [
    ["blue", "Blue Prints"],
    ["irma", "Irmá"],
    ["out", "Other"],
  ]) {
    db.prepare("INSERT INTO projects (id, name, path) VALUES (?, ?, ?)").run(id, name, `/x/${id}`);
    db.prepare(
      "INSERT INTO agents (id, project_id, cli_type, task_description, status) VALUES (?, ?, 'claude-code', 't', 'running')",
    ).run(`a-${id}`, id);
  }
  colab = createColab(db, "Landings", "");
  addColabMember(db, colab, { projectId: "blue", repo: "", role: "" });
  addColabMember(db, colab, { projectId: "irma", repo: "", role: "" });
});

afterAll(() => rm(notesRoot(), { recursive: true, force: true }));

const blueFolder = () => notesFolder(db, { scope: "project", projectId: "blue" });
const claimBlue = () => notesFolder(db, { scope: "project", projectId: "blue" }, true)!;

describe("notes folders", () => {
  it("are named on the first write, from the project, so a rename keeps them", () => {
    expect(blueFolder()).toBeNull();
    expect(claimBlue().shown).toBe("~/.exegol/notes/projects/blue-prints");
    db.prepare("UPDATE projects SET name = 'Renamed' WHERE id = 'blue'").run();
    expect(blueFolder()?.shown).toBe("~/.exegol/notes/projects/blue-prints");
    db.prepare("UPDATE projects SET name = 'Blue prints!' WHERE id = 'out'").run();
    const claim = (projectId: string) => notesFolder(db, { scope: "project", projectId }, true);
    expect(claim("out")?.shown).toMatch(/blue-prints-2$/);
    expect(claim("irma")?.shown).toMatch(/irma$/);
  });
});

describe("notes files", () => {
  it("write a file with its frontmatter and rebuild the index by group", async () => {
    const folder = claimBlue();
    await writeNote(folder, { title: "Why: no ORM", body: "Raw SQL.", group: "Decisions" }, author);
    await writeNote(folder, { title: "Why: no ORM", body: "Second one" }, author);
    const index = await readFile(join(folder.dir, INDEX_FILE), "utf8");
    expect(index).toContain("## Decisions\n\n- [Why: no ORM](why-no-orm.md)");
    expect(index).toContain("## General\n\n- [Why: no ORM](why-no-orm-2.md)");
    const note = await readNote(folder, "why-no-orm");
    expect(note).toMatchObject({ title: "Why: no ORM", body: "Raw SQL.", session: "a-blue" });
  });

  it("refuse past the limits and name the oldest", async () => {
    const folder = claimBlue();
    await expect(
      writeNote(folder, { title: "Long", body: "x".repeat(NOTE_BODY_MAX + 1) }, author),
    ).rejects.toThrow(`at most ${NOTE_BODY_MAX}`);
    for (let i = 0; i < NOTES_PER_FOLDER; i++) {
      await writeNote(folder, { title: `n${i}`, body: "b" }, author);
    }
    await expect(writeNote(folder, { title: "one more", body: "b" }, author)).rejects.toThrow(
      /its limit\. .*Oldest: n\d+ \(/,
    );
  });
});

describe("notes tools", () => {
  it("let a session rewrite only its own note, and any retire one with a reason", async () => {
    const { id } = await call("note_write", { title: "Gotcha", body: "Safari" });
    await call("note_write", { id, title: "Gotcha", body: "Safari 17" });
    await expect(
      call("note_write", { id, title: "Mine now", body: "x" }, "a-blue2", "blue"),
    ).rejects.toThrow("written by another session");
    await call("note_retire", { id, reason: "Fixed upstream" });
    expect((await call("note_list", {})).count).toBe(0);
    expect(await call("note_read", { id })).toMatchObject({
      content: "Safari 17",
      retiredReason: "Fixed upstream",
    });
    expect(await readFile(join(blueFolder()!.dir, INDEX_FILE), "utf8")).not.toContain("Gotcha");
  });

  it("reach a colab's notes from members only, its bodies marked as data", async () => {
    const { id } = await call("note_write", {
      scope: "colab",
      colab: "Landings",
      title: "T",
      body: "B",
    });
    const read = await call("note_read", { scope: "colab", colab: "landings", id }, "a-irma");
    expect(read.untrusted_note_content).toBe("B");
    expect(read.content).toBeUndefined();
    await expect(call("note_list", { scope: "colab", colab: "Landings" }, "a-out")).rejects.toThrow(
      "No colab named",
    );
  });

  it("tell a starting session its titles, and a colab's only as a count", async () => {
    expect(await sessionLine(db, "irma")).not.toContain("notes");
    await call("note_write", { title: "Use pnpm", body: "Not npm" }, "a-irma");
    await call("note_write", { scope: "colab", colab: "Landings", title: "Secret", body: "S" });
    const line = await sessionLine(db, "irma");
    expect(line).toContain(
      'This project\'s notes: 1 (~/.exegol/notes/projects/irma/, index in README.md). Newest first: "Use pnpm"',
    );
    expect(line).toContain("Its notes: 1, see note_list scope colab.");
    expect(line).not.toContain("Secret");
  });
});
