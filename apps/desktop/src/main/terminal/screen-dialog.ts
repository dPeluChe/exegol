import type { ScreenDialog } from "@exegol/shared";

// "❯ 1. Yes", "  2. Yes, and don't ask again", box borders around them are stripped first
const OPTION = /^[\s│|]*[❯>›]?\s*(\d)[.)]\s+(.+?)[\s│|]*$/;
// A question picker: "❯ 1 Yes" with the selection on an option, a line of help under each. The
// selection is what tells it from a list in an answer, so `>` (a quote) does not count here
const PICKED = /^[\s│|]*[❯›]\s*(\d)[.)]?\s+(.+?)[\s│|]*$/;
const PICKER_OPTION = /^[\s│|]*(?:[❯›]\s*)?(\d)[.)]?\s+(.+?)[\s│|]*$/;
const CONTEXT_LINES = 6;
/** Help lines under an option */
const MAX_GAP = 2;
/** What may sit under a picker: "Other", a rule, a footer of hints */
const MAX_PICKER_TAIL = 8;
const PICKER_REACH = 30;

/** The next option from `from`, stepping by `step`, at most `MAX_GAP` help lines away */
function pickerNeighbour(lines: string[], from: number, step: 1 | -1, key: number): number | null {
  for (let gap = 1; gap <= MAX_GAP + 1; gap++) {
    const m = PICKER_OPTION.exec(lines[from + step * gap] ?? "");
    if (m) return Number(m[1]) === key ? from + step * gap : null;
  }
  return null;
}

/** Options 1..k around the selected one, with help lines between them */
function readPicker(lines: string[], last: number): ScreenDialog | null {
  let cursor = last;
  while (cursor >= 0 && last - cursor < PICKER_REACH && !PICKED.test(lines[cursor] ?? "")) cursor--;
  const picked = PICKED.exec(lines[cursor] ?? "");
  if (!picked) return null;
  const rows = [cursor];
  let key = Number(picked[1]);
  for (let at = cursor, next = key - 1; next >= 1; next--) {
    const above = pickerNeighbour(lines, at, -1, next);
    if (above === null) return null;
    rows.unshift(above);
    at = above;
  }
  for (let at = cursor; ; ) {
    const below = pickerNeighbour(lines, at, 1, key + 1);
    if (below === null) break;
    rows.push(below);
    at = below;
    key++;
  }
  const end = rows.at(-1) as number;
  if (rows.length < 2 || last - end > MAX_PICKER_TAIL) return null;
  const options = rows.map((row) => {
    const m = PICKER_OPTION.exec(lines[row] ?? "") as RegExpExecArray;
    return { key: m[1] as string, label: (m[2] as string).trim() };
  });
  return dialogAt(lines, rows[0] as number, options, true);
}

function dialogAt(
  lines: string[],
  start: number,
  options: ScreenDialog["options"],
  picked: boolean,
): ScreenDialog {
  const above = lines.slice(Math.max(0, start - CONTEXT_LINES - 1), start).map(clean);
  const qIndex = above.map((l) => l.endsWith("?")).lastIndexOf(true);
  const question = qIndex >= 0 ? (above[qIndex] as string) : null;
  // Separator rules (╌╌╌, ───) say nothing
  const context = (qIndex >= 0 ? above.slice(0, qIndex) : above).filter(
    (l) => l && !/^[╌─━═\s-]+$/.test(l),
  );
  return {
    question,
    context,
    options,
    picked,
    fingerprint: [question ?? "", ...context].join("\n"),
  };
}

/** The numbered dialog at the bottom of a screen: options 1..k in order with at most a border or
 *  footer after them, or a picker. Anything else (a stray "1.", numbers out of order) is not one */
export function readScreenDialog(lines: string[]): ScreenDialog | null {
  // The empty rows under a short screen are not output after the dialog
  let last = lines.length - 1;
  while (last >= 0 && !(lines[last] ?? "").trim()) last--;
  return readPlainList(lines, last) ?? readPicker(lines, last);
}

function readPlainList(lines: string[], last: number): ScreenDialog | null {
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
  const picked = lines.slice(start, end + 1).some((l) => /^[\s│|]*[❯›>]/.test(l));
  return dialogAt(lines, start, options, picked);
}

const clean = (line: string) => line.replace(/^[\s│|╭╰─]+|[\s│|╮╯─]+$/g, "").trim();
