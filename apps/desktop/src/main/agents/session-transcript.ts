import { open } from "node:fs/promises";
import type { OlderChatPage, SessionTurn } from "@exegol/shared";
import { BOILERPLATE_PREFIXES } from "../history/providers/codex";

/** One read of a transcript, and the first read's window: a session log reaches tens of MB */
export const MAX_READ_BYTES = 2 * 1024 * 1024;
const NEWLINE = 0x0a;
const MAX_TURN_CHARS = 8000;
const OLDER_MIN_TURNS = 40;
// Tool results fill a log: a window can hold no turn at all
const OLDER_MAX_READS = 5;

export type LineParser = (line: string, id: string) => SessionTurn[];

export interface ReadPlan {
  offset: number;
  length: number;
  /** The cursor no longer applies: the file is another one or shrank */
  reset: boolean;
  /** Started mid-file, so the first line is a fragment */
  dropFirstLine: boolean;
}

export function planRead(
  cursor: string | undefined,
  file: { ino: number; size: number },
): ReadPlan {
  const [ino, offset] = (cursor ?? "").split(":").map(Number);
  if (cursor && ino === file.ino && offset !== undefined && offset <= file.size) {
    const length = Math.min(MAX_READ_BYTES, file.size - offset);
    return { offset, length, reset: false, dropFirstLine: false };
  }
  const start = Math.max(0, file.size - MAX_READ_BYTES);
  return { offset: start, length: file.size - start, reset: true, dropFirstLine: start > 0 };
}

/** The window ending at `before` ("ino:offset", from a read's `older`). Null when spent or stale */
export function planOlder(before: string, file: { ino: number; size: number }): ReadPlan | null {
  const [ino, end] = before.split(":").map(Number);
  if (ino !== file.ino || !end || end > file.size) return null;
  const offset = Math.max(0, end - MAX_READ_BYTES);
  return { offset, length: end - offset, reset: false, dropFirstLine: offset > 0 };
}

/** Whole lines only: a partial last line stays for the next read */
export function parseChunk(
  chunk: Buffer,
  plan: Pick<ReadPlan, "offset" | "dropFirstLine">,
  parse: LineParser,
): { turns: SessionTurn[]; nextOffset: number; firstOffset: number } {
  const end = chunk.lastIndexOf(NEWLINE) + 1;
  // A single line over the cap would stall the tail for good: step past it
  if (end === 0) {
    const stuck = chunk.length >= MAX_READ_BYTES;
    return {
      turns: [],
      nextOffset: plan.offset + (stuck ? chunk.length : 0),
      firstOffset: plan.offset,
    };
  }
  const turns: SessionTurn[] = [];
  let start = plan.dropFirstLine ? chunk.indexOf(NEWLINE) + 1 : 0;
  const firstOffset = plan.offset + start;
  while (start < end) {
    const stop = chunk.indexOf(NEWLINE, start);
    turns.push(...parse(chunk.toString("utf8", start, stop), String(plan.offset + start)));
    start = stop + 1;
  }
  return { turns, nextOffset: plan.offset + end, firstOffset };
}

/** Walks back from `before`, one window at a time, until there is a page to show */
export async function readOlder(
  path: string,
  parse: LineParser,
  before: string,
): Promise<OlderChatPage> {
  const handle = await open(path, "r");
  try {
    const file = await handle.stat();
    let turns: SessionTurn[] = [];
    let older: string | null = before;
    for (let read = 0; older && read < OLDER_MAX_READS && turns.length < OLDER_MIN_TURNS; read++) {
      const plan = planOlder(older, file);
      if (!plan) return { turns, older: null };
      const chunk = Buffer.alloc(plan.length);
      const { bytesRead } = await handle.read(chunk, 0, plan.length, plan.offset);
      const page = parseChunk(chunk.subarray(0, bytesRead), plan, parse);
      turns = [...page.turns, ...turns];
      // One line over the window has no start in it: step past it
      const end = plan.offset + plan.length;
      const first = page.firstOffset < end ? page.firstOffset : plan.offset;
      older = first > 0 ? `${file.ino}:${first}` : null;
    }
    return { turns, older };
  } finally {
    await handle.close();
  }
}

const secondsOf = (timestamp: unknown): number | null => {
  const ms = typeof timestamp === "string" ? Date.parse(timestamp) : Number.NaN;
  return Number.isNaN(ms) ? null : Math.floor(ms / 1000);
};

function jsonLine(line: string): Record<string, unknown> | null {
  try {
    const value = JSON.parse(line);
    return value && typeof value === "object" ? value : null;
  } catch {
    return null;
  }
}

const textTurn = (id: string, role: SessionTurn["role"], text: string, at: number | null) => {
  const clean = text.trim().slice(0, MAX_TURN_CHARS);
  return clean ? [{ id, role, text: clean, at }] : [];
};

// What Claude Code writes as a user line and nobody typed
const CLAUDE_SCAFFOLD = /^<(command-|local-command|system-reminder|task-notification|bash-)/;

interface Block {
  type?: string;
  text?: string;
  name?: string;
}

/** Text and tool names only: a tool's input and result never reach the chat */
export const parseClaudeLine: LineParser = (line, id) => {
  const d = jsonLine(line);
  if (!d || (d.type !== "user" && d.type !== "assistant")) return [];
  if (d.isSidechain || d.isMeta || d.isCompactSummary) return [];
  const at = secondsOf(d.timestamp);
  const content = (d.message as { content?: unknown } | undefined)?.content;
  const blocks: Block[] =
    typeof content === "string"
      ? [{ type: "text", text: content }]
      : Array.isArray(content)
        ? content
        : [];
  return blocks.flatMap((b, i): SessionTurn[] => {
    const turnId = `${id}:${i}`;
    if (b.type === "tool_use" && d.type === "assistant") {
      return textTurn(turnId, "tool", b.name ?? "", at);
    }
    if (b.type !== "text" || !b.text) return [];
    if (d.type === "user" && CLAUDE_SCAFFOLD.test(b.text.trimStart())) return [];
    return textTurn(turnId, d.type === "user" ? "user" : "assistant", b.text, at);
  });
};

export const parseCodexLine: LineParser = (line, id) => {
  const d = jsonLine(line);
  if (d?.type !== "response_item") return [];
  const at = secondsOf(d.timestamp);
  const p = d.payload as {
    type?: string;
    role?: string;
    name?: string;
    content?: Array<{ text?: string }>;
  };
  if (p?.type === "function_call" || p?.type === "custom_tool_call") {
    return textTurn(id, "tool", p.name ?? "", at);
  }
  if (p?.type !== "message" || (p.role !== "user" && p.role !== "assistant")) return [];
  const text = (p.content ?? []).map((c) => c.text ?? "").join("");
  const typed = text.trimStart();
  if (p.role === "user" && BOILERPLATE_PREFIXES.some((b) => typed.startsWith(b))) return [];
  return textTurn(id, p.role, text, at);
};

const CHROME = /^[\s─━═╌│|╭╮╰╯┌┐└┘├┤┬┴┼▔▁]*$/;
const EDGES = /^[\s│|]+|[\s│|]+$/g;

function plainText(lines: string[]): string {
  return lines
    .filter((l) => !CHROME.test(l) || !l.trim())
    .map((l) => l.replace(EDGES, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n");
}

/** A CLI with no transcript: its terminal text, cut at the turn boundaries seen. `first` is the
 *  buffer line `lines` starts at. A TUI on the alt screen has one screen and no history */
export function terminalTurns(
  lines: string[],
  first: number,
  marks: number[],
  altScreen: boolean,
): SessionTurn[] {
  const cuts = altScreen ? [] : marks.filter((m) => m > first && m < first + lines.length);
  const bounds = [first, ...cuts, first + lines.length];
  return bounds.slice(0, -1).flatMap((from, i) => {
    const part = lines.slice(from - first, (bounds[i + 1] as number) - first);
    return textTurn(`term:${from}`, "assistant", plainText(part), null);
  });
}
