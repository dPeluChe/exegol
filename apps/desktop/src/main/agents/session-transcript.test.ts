import { describe, expect, it } from "vitest";
import {
  MAX_READ_BYTES,
  parseChunk,
  parseClaudeLine,
  parseCodexLine,
  planRead,
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
});

describe("parseCodexLine", () => {
  const item = (payload: unknown) => JSON.stringify({ type: "response_item", payload });

  it("reads messages and tool names, not the scaffolding", () => {
    const say = (role: string, text: string) => ({ type: "message", role, content: [{ text }] });
    expect(parseCodexLine(item(say("assistant", "ok")), "1")).toMatchObject([{ text: "ok" }]);
    expect(parseCodexLine(item(say("user", "<environment_context>")), "1")).toEqual([]);
    expect(parseCodexLine(item(say("developer", "rules")), "1")).toEqual([]);
    expect(
      parseCodexLine(item({ type: "function_call", name: "shell", arguments: "x" }), "1"),
    ).toMatchObject([{ role: "tool", text: "shell" }]);
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
