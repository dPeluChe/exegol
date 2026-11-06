import type { SessionTurn } from "@exegol/shared";
import { textTurn } from "./session-transcript";

const RULE = /^\s*─+\s*$/;
const PROMPT = /^> ?(.*)$/;
const ACTIVITY = /^[●○▸]\s+(.*)$/;
const SPINNER = /^\s*[⣾⣷⣯⣟⡿⢿⣻⣽✻⚠…]/;
const TABLE = /^\s*[│├┌└]|^\s*─+.*[┬┼┴]|│/;
const BLOCK_START = /^\s*([-*•]|\d+\.|#{1,6})\s/;
/** How far short of the longest line a line can stop and still be one the TUI wrapped */
const WRAP_SLACK = 20;
const TABLE_GAP = 2;

const activityName = (text: string) =>
  text
    .replace(/\s*\(ctrl\+.*$/, "")
    .replace(/\s+\(.*$/, "")
    .replace(/,\s*[\d.]+k? tokens$/, "")
    .slice(0, 60);

/** Tables stay as printed; the TUI's own wrapping goes, line breaks it did not make stay */
function asMarkdown(block: string[]): string {
  const lines = block.map((l) => l.replace(/^ {2}/, "").replace(/^(\s*)• /, "$1- "));
  const width = Math.max(...lines.map((l) => l.length));
  const out: string[] = [];
  let tableEnd = -1;
  lines.forEach((line, i) => {
    if (i > tableEnd && TABLE.test(line)) {
      tableEnd = i;
      for (let next = i + 1; next < lines.length && next <= tableEnd + TABLE_GAP; next++) {
        if (TABLE.test(lines[next] as string)) tableEnd = next;
      }
      out.push("```", ...lines.slice(i, tableEnd + 1), "```");
      return;
    }
    if (i <= tableEnd) return;
    const last = out.at(-1);
    const wrapped =
      !!last?.trim() &&
      last !== "```" &&
      !!line.trim() &&
      !BLOCK_START.test(line) &&
      last.length >= width - WRAP_SLACK;
    if (wrapped) out[out.length - 1] = `${last} ${line.trim()}`;
    else out.push(line);
  });
  let fenced = false;
  return out
    .map((line, i) => {
      if (line === "```") fenced = !fenced;
      const breaks = !fenced && line !== "```" && line.trim() && out[i + 1]?.trim();
      return breaks && out[i + 1] !== "```" ? `${line}  ` : line;
    })
    .join("\n");
}

/** Antigravity keeps its turns in undocumented protobuf, so its screen is what can be read: `> `
 *  prompts, `●○▸` activity rows, answers in raw Markdown. The last `> ` before a rule is its input
 *  box. Null when nothing there looks like that */
export function agyTurns(lines: string[], first: number): SessionTurn[] | null {
  const turns: SessionTurn[] = [];
  let answer: string[] = [];
  let answerAt = 0;
  let started = false;
  const flush = () => {
    const block = answer.filter((l) => !RULE.test(l));
    if (block.some((l) => l.trim())) {
      turns.push(...textTurn(`term:${answerAt}`, "assistant", asMarkdown(block), null));
    }
    answer = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] as string;
    const prompt = PROMPT.exec(line);
    if (prompt) {
      const text = [prompt[1] as string];
      let next = i + 1;
      while (/^ {2}\s*\S/.test(lines[next] ?? "")) text.push((lines[next++] as string).trim());
      if (RULE.test(lines[next] ?? "")) break;
      flush();
      started = true;
      turns.push(...textTurn(`term:${first + i}`, "user", text.join(" "), null));
      i = next - 1;
      continue;
    }
    if (!started) continue;
    const activity = ACTIVITY.exec(line);
    if (activity) {
      flush();
      turns.push(
        ...textTurn(`term:${first + i}`, "tool", activityName(activity[1] as string), null),
      );
      continue;
    }
    if (SPINNER.test(line)) continue;
    if (answer.length === 0) answerAt = first + i;
    answer.push(line);
  }
  flush();
  return started ? turns : null;
}
