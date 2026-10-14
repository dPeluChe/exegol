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
const SOFT_BEFORE = /[\s,.;:]*$/u;
const ATTACHED_AFTER = /^[.,;:!?]+/u;

const prevWord = (text: string): string | null =>
  /(\p{L}+)\s+$/u.exec(text)?.[1]?.toLowerCase() ?? null;

function applies(cmd: Command, before: string, rest: string, nextIsCommand: boolean): boolean {
  const word = prevWord(before);
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
    if (!applies(cmd, text.slice(0, start), rest, nextIsCommand)) return;
    end += ATTACHED_AFTER.exec(rest)?.[0].length ?? 0;
    emit(text.slice(pos, start));
    pos = end;
    if (cmd.kind === "close") {
      out = out.replace(SOFT_BEFORE, "") + cmd.out;
      spaceNext = true;
      if (/[.?!]$/.test(cmd.out)) capNext = true;
      return;
    }
    if (cmd.kind === "break") {
      out = out.replace(/[ \t]+$/, "") + cmd.out;
      spaceNext = false;
      capNext = true;
      pos += /^[ \t]*/.exec(text.slice(pos))?.[0].length ?? 0;
      return;
    }
    const trimmed = out.replace(/[ \t]+$/, "");
    if (trimmed === "" || /[.?!\n]$/.test(trimmed)) capNext = true;
    out = trimmed && !/[\n¿¡]$/.test(trimmed) ? `${trimmed} ${cmd.out}` : trimmed + cmd.out;
    spaceNext = false;
    pos += /^\s*/.exec(text.slice(pos))?.[0].length ?? 0;
  });
  emit(text.slice(pos));
  return out.replace(/^[ \t]+|[ \t]+$/g, "");
}
