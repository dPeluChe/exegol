import type { ScreenDialog } from "@exegol/shared";

// "❯ 1. Yes", "  2. Yes, and don't ask again", box borders around them are stripped first
const OPTION = /^[\s│|]*[❯>›]?\s*(\d)[.)]\s+(.+?)[\s│|]*$/;
const CONTEXT_LINES = 6;

/** The numbered dialog at the bottom of a screen: options 1..k in order with at most a border or
 *  footer after them. Anything else (a stray "1.", numbers out of order) is not a dialog */
export function readScreenDialog(lines: string[]): ScreenDialog | null {
  // The empty rows under a short screen are not output after the dialog
  let last = lines.length - 1;
  while (last >= 0 && !(lines[last] ?? "").trim()) last--;
  let end = last;
  while (end >= 0 && !OPTION.test(lines[end] ?? "")) {
    // A border or a footer hint ("Esc to cancel") may follow; more means it is not current
    if (last - end > 3) return null;
    end--;
  }
  if (end < 0) return null;
  let start = end;
  while (start > 0 && OPTION.test(lines[start - 1] ?? "")) start--;
  const options = lines.slice(start, end + 1).map((l) => {
    const m = OPTION.exec(l) as RegExpExecArray;
    return { key: m[1] as string, label: (m[2] as string).trim() };
  });
  const inOrder = options.every((o, i) => o.key === String(i + 1));
  if (options.length < 2 || !inOrder) return null;
  const above = lines.slice(Math.max(0, start - CONTEXT_LINES - 1), start).map(clean);
  const qIndex = above.map((l) => l.endsWith("?")).lastIndexOf(true);
  const question = qIndex >= 0 ? (above[qIndex] as string) : null;
  // Separator rules (╌╌╌, ───) say nothing
  const context = (qIndex >= 0 ? above.slice(0, qIndex) : above).filter(
    (l) => l && !/^[╌─━═\s-]+$/.test(l),
  );
  return { question, context, options, fingerprint: [question ?? "", ...context].join("\n") };
}

const clean = (line: string) => line.replace(/^[\s│|╭╰─]+|[\s│|╮╯─]+$/g, "").trim();
