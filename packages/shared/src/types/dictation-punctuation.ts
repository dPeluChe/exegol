/** Spoken punctuation for dictation (Spanish and English): "coma" becomes ",", "new line" a line
 *  break. Rules and limits: docs/GUIDES/FEATURES.md (Voice dictation) */

type Kind = "close" | "open" | "break";
/** `sentence`: an ambiguous word ("punto", "period") counts only before a pause, a capital, the
 *  end or another command. `notDe`: "dos puntos de vista" stays words */
type Guard = "sentence" | "notDe";

interface Command {
  source: string;
  out: string;
  kind: Kind;
  guard?: Guard;
}

const O = "[oó]";
const I = "[ií]";
const A = "[aá]";

// Longest first: the alternation takes the first that matches at a position
const COMMANDS: Command[] = [
  { source: "punto y coma", out: ";", kind: "close" },
  { source: "punto y aparte", out: ".\n\n", kind: "break" },
  { source: "punto y seguido", out: ".", kind: "close" },
  { source: "punto final", out: ".", kind: "close" },
  { source: "dos puntos", out: ":", kind: "close", guard: "notDe" },
  { source: `(?:abre|abrir) (?:signo de )?interrogaci${O}n`, out: "¿", kind: "open" },
  { source: `(?:cierra|cerrar) (?:signo de )?interrogaci${O}n`, out: "?", kind: "close" },
  { source: `signo de interrogaci${O}n`, out: "?", kind: "close" },
  { source: `(?:abre|abrir) (?:signo de )?exclamaci${O}n`, out: "¡", kind: "open" },
  { source: `(?:cierra|cerrar) (?:signo de )?exclamaci${O}n`, out: "!", kind: "close" },
  { source: `signo de exclamaci${O}n`, out: "!", kind: "close" },
  { source: `nuevo p${A}rrafo`, out: "\n\n", kind: "break" },
  { source: `(?:nueva|salto de) l${I}nea`, out: "\n", kind: "break" },
  { source: "coma", out: ",", kind: "close" },
  { source: "punto", out: ".", kind: "close", guard: "sentence" },
  { source: "semicolon", out: ";", kind: "close" },
  { source: "full stop", out: ".", kind: "close" },
  { source: "question mark", out: "?", kind: "close" },
  { source: "exclamation (?:mark|point)", out: "!", kind: "close" },
  { source: "new paragraph", out: "\n\n", kind: "break" },
  { source: "new line|newline", out: "\n", kind: "break" },
  { source: "comma", out: ",", kind: "close" },
  { source: "colon", out: ":", kind: "close" },
  { source: "period", out: ".", kind: "close", guard: "sentence" },
];

const PATTERN = new RegExp(
  `(?<![\\p{L}\\p{N}])(?:${COMMANDS.map((c) => `(${c.source.replace(/ /g, "\\s+")})`).join("|")})(?![\\p{L}\\p{N}])`,
  "giu",
);

/** "la coma", "el punto es", "a new line": an article or determiner makes it a word */
const DETERMINERS = new Set([
  "el",
  "la",
  "los",
  "las",
  "un",
  "una",
  "unos",
  "unas",
  "otro",
  "otra",
  "este",
  "esta",
  "ese",
  "esa",
  "cada",
  "del",
  "al",
  "su",
  "mi",
  "tu",
  "a",
  "an",
  "the",
  "another",
  "this",
  "that",
  "each",
  "every",
  "my",
  "your",
  "its",
]);

/** What the model writes at a pause around the spoken word: it gives way to the command */
const isSoft = (c: string) => /[\s,.;:]/u.test(c);
const isBlank = (c: string) => c === " " || c === "\t";
const ATTACHED_AFTER = /^[.,;:!?]+/u;

/** Drops trailing chars walking back from the end: the text built so far is never rescanned */
function trimEnd(text: string, drop: (c: string) => boolean): string {
  let end = text.length;
  while (end > 0 && drop(text[end - 1] as string)) end--;
  return end === text.length ? text : text.slice(0, end);
}

/** The word before `end`, from a short look back: determiners are short words */
function prevWord(text: string, end: number): string | null {
  const from = Math.max(0, end - 32);
  const m = /(\p{L}+)\s+$/u.exec(text.slice(from, end));
  if (!m?.[1] || (from > 0 && m.index === 0)) return null;
  return m[1].toLowerCase();
}

function applies(cmd: Command, word: string | null, rest: string, nextIsCommand: boolean): boolean {
  if (word && DETERMINERS.has(word)) return false;
  if (cmd.guard === "notDe") return !/^\s+de(?![\p{L}\p{N}])/iu.test(rest);
  if (cmd.guard === "sentence") {
    return nextIsCommand || /^\s*(?:$|[.,;:!?\n]|\p{Lu})/u.test(rest);
  }
  return true;
}

const capitalize = (text: string): string =>
  text.replace(/^(\s*)(\p{Ll})/u, (_m, space: string, c: string) => space + c.toUpperCase());

/** Spoken punctuation words become the marks, with the spacing and capitals fixed around them */
export function applySpokenPunctuation(text: string): string {
  const matches = [...text.matchAll(PATTERN)];
  if (matches.length === 0) return text;
  let out = "";
  let pos = 0;
  let capNext = false;
  /** After a closing mark the next words need exactly one space */
  let spaceNext = false;

  const emit = (raw: string) => {
    let piece = raw;
    if (spaceNext) {
      piece = piece.replace(/^[ \t]+/, "");
      if (piece && !/^[\n.,;:!?)\]]/.test(piece)) piece = ` ${piece}`;
    }
    if (capNext && /\p{L}/u.test(piece)) {
      piece = capitalize(piece);
      capNext = false;
    }
    if (piece) spaceNext = false;
    out += piece;
  };

  matches.forEach((m, i) => {
    const start = m.index ?? 0;
    if (start < pos) return;
    const cmd = COMMANDS[m.slice(1).findIndex((g) => g !== undefined)];
    if (!cmd) return;
    let end = start + m[0].length;
    const rest = text.slice(end);
    const next = matches[i + 1];
    const nextIsCommand =
      next?.index !== undefined && text.slice(end, next.index).trim() === "" && next.index > end;
    if (!applies(cmd, prevWord(text, start), rest, nextIsCommand)) return;
    end += ATTACHED_AFTER.exec(rest)?.[0].length ?? 0;
    emit(text.slice(pos, start));
    pos = end;
    if (cmd.kind === "close") {
      out = trimEnd(out, isSoft) + cmd.out;
      spaceNext = true;
      if (/[.?!]$/.test(cmd.out)) capNext = true;
      return;
    }
    if (cmd.kind === "break") {
      out = trimEnd(out, isBlank) + cmd.out;
      spaceNext = false;
      capNext = true;
      pos += /^[ \t]*/.exec(text.slice(pos))?.[0].length ?? 0;
      return;
    }
    const trimmed = trimEnd(out, isBlank);
    if (trimmed === "" || /[.?!\n]$/.test(trimmed)) capNext = true;
    out = trimmed && !/[\n¿¡]$/.test(trimmed) ? `${trimmed} ${cmd.out}` : trimmed + cmd.out;
    spaceNext = false;
    pos += /^\s*/.exec(text.slice(pos))?.[0].length ?? 0;
  });
  emit(text.slice(pos));
  return out.replace(/^[ \t]+|[ \t]+$/g, "");
}
