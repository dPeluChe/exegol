import { stripTerminalReports } from "@exegol/shared";

const ESC = "\x1b";
const PASTE_START = "\x1b[200~";
const PASTE_END = "\x1b[201~";

function typedLength(length: number, typed: string): number {
  let next = length;
  for (const char of typed) {
    if (char === "\r" || char === "\x03" || char === "\x15") next = 0;
    else if (char === "\x7f" || char === "\b") next = Math.max(0, next - 1);
    else if (char === "\n" || char >= " ") next += 1;
  }
  return next;
}

/**
 * Characters left in a CLI's prompt after a chunk of the person's input, as far as bytes can tell.
 * What still starts with ESC is a key or a mouse event, which adds no text. `\n` stays text: Ctrl+J
 * is a new line in these prompts, only `\r` submits.
 */
export function draftLengthAfter(length: number, data: string): number {
  const input = stripTerminalReports(data);
  if (input.startsWith(PASTE_START)) {
    const end = input.indexOf(PASTE_END);
    if (end === -1) return length + input.length - PASTE_START.length;
    const pasted = end - PASTE_START.length;
    return typedLength(length + pasted, input.slice(end + PASTE_END.length));
  }
  return input.startsWith(ESC) ? length : typedLength(length, input);
}

/** Sizes and control codes only, never the text: what made Exegol think a prompt holds a draft */
export function inputShape(data: string): string {
  const input = stripTerminalReports(data);
  const controls = [...input]
    .filter((c) => c < " " || c === "\x7f")
    .slice(0, 6)
    .map((c) => `0x${c.charCodeAt(0).toString(16).padStart(2, "0")}`);
  const printable = [...input].filter((c) => c >= " " && c !== "\x7f").length;
  return `${input.length} char(s), ${printable} printable${controls.length ? `, controls ${controls.join(" ")}` : ""}`;
}
