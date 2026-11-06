import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  type LineParser,
  MAX_READ_BYTES,
  parseChunk,
  parseClaudeLine,
  parseCodexLine,
  planOlder,
  planRead,
  readOlder,
  readTranscript,
  terminalTurns,
} from "./session-transcript";

const claude = (type: string, content: unknown, extra = {}) =>
  JSON.stringify({
    type,
    timestamp: "2026-11-04T10:00:00Z",
    message: { content },
    ...extra,
  });

describe("planRead", () => {
  const file = { ino: 7, size: 100 };

  it("continues from the cursor", () => {
    expect(planRead("7:40", file)).toMatchObject({ offset: 40, length: 60, reset: false });
  });

  it("starts over when the file shrank or was replaced", () => {
    expect(planRead("7:400", file)).toMatchObject({ offset: 0, reset: true });
    expect(planRead("8:40", file)).toMatchObject({ offset: 0, reset: true });
  });

  it("opens a large file at its tail, past a fragment", () => {
    const big = { ino: 7, size: MAX_READ_BYTES + 10 };
    expect(planRead(undefined, big)).toMatchObject({ offset: 10, dropFirstLine: true });
  });
});

describe("planOlder", () => {
  it("ends the window at the line asked for, and refuses a spent or stale token", () => {
    const file = { ino: 7, size: 100 };
    expect(planOlder("7:40", file)).toMatchObject({ offset: 0, length: 40, dropFirstLine: false });
    expect(planOlder("7:0", file)).toBeNull();
    expect(planOlder("8:40", file)).toBeNull();
    expect(planOlder("7:400", file)).toBeNull();
  });
});

describe("readOlder", () => {
  it("walks a large log back to its start with no line lost or repeated", async () => {
    const dir = await mkdtemp(join(tmpdir(), "exegol-transcript-"));
    const path = join(dir, "log.jsonl");
    const line = (i: number) => `${i} ${"x".repeat(100_000)}`;
    await writeFile(path, `${Array.from({ length: 70 }, (_, i) => line(i)).join("\n")}\n`);
    const parse: LineParser = (text) => [
      { id: text.split(" ")[0] ?? "", role: "assistant", text: "t", at: null },
    ];

    const first = await readTranscript(path, parse, undefined);

    let seen = first.turns.map((t) => t.id);
    let older = first.older;
    while (older) {
      const page = await readOlder(path, parse, older);
      seen = [...page.turns.map((t) => t.id), ...seen];
      older = page.older;
    }
    await rm(dir, { recursive: true });
    expect(seen).toEqual(Array.from({ length: 70 }, (_, i) => String(i)));
  });

  it("steps past a line longer than the window", async () => {
    const dir = await mkdtemp(join(tmpdir(), "exegol-transcript-"));
    const path = join(dir, "log.jsonl");
    await writeFile(path, `a\n${"x".repeat(MAX_READ_BYTES + 10)}\nb\n`);
    const { ino, size } = await stat(path);
    const parse: LineParser = (text) =>
      text.length < 5 ? [{ id: text, role: "assistant", text, at: null }] : [];
    const page = await readOlder(path, parse, `${ino}:${size - 2}`);
    await rm(dir, { recursive: true });
    expect(page.turns.map((t) => t.id)).toEqual(["a"]);
    expect(page.older).toBeNull();
  });
});

describe("parseChunk", () => {
  const line = claude("assistant", [{ type: "text", text: "done" }]);

  it("leaves a partial last line for the next read", () => {
    const chunk = Buffer.from(`${line}\n{"type":"assi`);
    const { turns, nextOffset } = parseChunk(
      chunk,
      { offset: 10, dropFirstLine: false },
      parseClaudeLine,
    );
    expect(turns.map((t) => t.text)).toEqual(["done"]);
    expect(nextOffset).toBe(10 + Buffer.byteLength(line) + 1);
  });

  it("drops the fragment a mid-file read starts on", () => {
    const chunk = Buffer.from(`ment"}\n${line}\n`);
    const plan = { offset: 0, dropFirstLine: true };
    expect(parseChunk(chunk, plan, parseClaudeLine).turns).toHaveLength(1);
  });

  it("steps past a line larger than one read", () => {
    const chunk = Buffer.alloc(MAX_READ_BYTES, 0x61);
    const plan = { offset: 5, dropFirstLine: false };
    expect(parseChunk(chunk, plan, parseClaudeLine).nextOffset).toBe(5 + MAX_READ_BYTES);
  });
});

describe("parseClaudeLine", () => {
  it("keeps the tool's name and nothing of its input", () => {
    const line = claude("assistant", [
      { type: "tool_use", name: "Bash", input: { command: "cat secret" } },
    ]);
    expect(parseClaudeLine(line, "1")).toMatchObject([{ role: "tool", text: "Bash" }]);
    expect(JSON.stringify(parseClaudeLine(line, "1"))).not.toContain("secret");
  });

  it("skips tool results, thinking, subagents and what nobody typed", () => {
    expect(parseClaudeLine(claude("user", [{ type: "tool_result" }]), "1")).toEqual([]);
    expect(parseClaudeLine(claude("assistant", [{ type: "thinking" }]), "1")).toEqual([]);
    expect(parseClaudeLine(claude("user", "hi", { isSidechain: true }), "1")).toEqual([]);
    expect(parseClaudeLine(claude("user", "<command-name>/clear"), "1")).toEqual([]);
  });

  it("reads a typed prompt", () => {
    expect(parseClaudeLine(claude("user", "fix it"), "1")).toMatchObject([
      { role: "user", text: "fix it", at: Date.parse("2026-11-04T10:00:00Z") / 1000 },
    ]);
  });

  it("skips a row of an unexpected shape, with the rest of the page kept", () => {
    const rows = [
      claude("user", [null]),
      claude("assistant", [{ type: "text", text: 7 }]),
      claude("assistant", 9),
      '{"type":"user"',
      "42",
      claude("user", "still here"),
    ];
    const chunk = Buffer.from(`${rows.join("\n")}\n`);
    const { turns } = parseChunk(chunk, { offset: 0, dropFirstLine: false }, parseClaudeLine);
    expect(turns.map((t) => t.text)).toEqual(["still here"]);
  });
});

describe("parseCodexLine", () => {
  const item = (payload: unknown) => JSON.stringify({ type: "response_item", payload });

  it("reads messages and tool names, not the scaffolding", () => {
    const say = (role: string, text: string) => ({ type: "message", role, content: [{ text }] });
    expect(parseCodexLine(item(say("assistant", "ok")), "1")).toMatchObject([{ text: "ok" }]);
    expect(parseCodexLine(item(say("developer", "rules")), "1")).toEqual([]);
    expect(
      parseCodexLine(item({ type: "function_call", name: "shell", arguments: "x" }), "1"),
    ).toMatchObject([{ role: "tool", text: "shell" }]);
  });

  it("skips a row of an unexpected shape", () => {
    expect(parseCodexLine(item({ type: "message", role: "user", content: "text" }), "1")).toEqual(
      [],
    );
    expect(parseCodexLine(item({ type: "function_call", name: 7 }), "1")).toEqual([]);
    expect(parseCodexLine("null", "1")).toEqual([]);
  });
});

describe("terminalTurns", () => {
  const lines = ["one", "╭───╮", "│ two │", "╰───╯", "three"];

  it("cuts at turn boundaries and strips the box", () => {
    expect(terminalTurns(lines, 100, [104], false).map((t) => t.text)).toEqual([
      "one\ntwo",
      "three",
    ]);
  });

  it("keeps one bubble on the alt screen, where line numbers mean nothing", () => {
    expect(terminalTurns(lines, 100, [104], true)).toHaveLength(1);
  });
});
