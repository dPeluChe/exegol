/** What of a Markdown reply is read aloud: its prose, in sentences, capped */

import { hostOf } from "../types/agent-browser";

const SPEECH_MAX_CHARS = 1500;
const SENTENCE_MAX_CHARS = 280;

const FENCE = /^\s*(```|~~~)/;
const TABLE_SEPARATOR = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)+\|?\s*$/;
const RULE = /^\s*([-*_])(\s*\1){2,}\s*$/;
const BARE_URL = /\bhttps?:\/\/[^\s)<>\]]+/gi;
const ENDS_SENTENCE = /[.!?…:;]$/;

const spokenHost = (url: string) => hostOf(url)?.replace(/^www\./, "") ?? "";

/** Drops fenced code (an unclosed fence runs to the end) and Markdown tables */
function proseLines(text: string): string[] {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const drop = new Set<number>();
  let fence: string | null = null;
  lines.forEach((line, i) => {
    const open = FENCE.exec(line)?.[1];
    if (fence) {
      drop.add(i);
      if (open === fence) fence = null;
    } else if (open) {
      fence = open;
      drop.add(i);
    }
  });
  lines.forEach((line, i) => {
    if (drop.has(i) || !TABLE_SEPARATOR.test(line)) return;
    drop.add(i);
    if (i > 0 && lines[i - 1]?.includes("|")) drop.add(i - 1);
    for (let j = i + 1; j < lines.length && lines[j]?.includes("|"); j++) drop.add(j);
  });
  return lines.map((line, i) =>
    drop.has(i) || line.trim().startsWith("|") || RULE.test(line) ? "" : line,
  );
}

function inline(text: string): string {
  return (
    text
      .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
      .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/<(https?:\/\/[^>\s]+)>/gi, (_m, url: string) => spokenHost(url))
      .replace(BARE_URL, spokenHost)
      .replace(/<\/?[a-z][^>]*>/gi, "")
      // Short inline code reads as words; a long one is code
      .replace(/`([^`]*)`/g, (_m, code: string) => (code.length <= 40 ? code : ""))
      .replace(/(\*\*|__|~~)(.+?)\1/g, "$2")
      .replace(/(^|[\s(])[*_]([^*_\s][^*_]*?)[*_](?=[\s).,;:!?]|$)/g, "$1$2")
      // "#37" reads as a number, not as the name of the sign
      .replace(/#(?=\d)/g, "")
      .replace(/\p{Extended_Pictographic}️?/gu, "")
      .replace(/\s+/g, " ")
      .trim()
  );
}

/** Each heading, list item or paragraph becomes one unit that ends in punctuation */
function units(text: string): string[] {
  const out: string[] = [];
  let paragraph: string[] = [];
  const flush = () => {
    const joined = inline(paragraph.join(" "));
    paragraph = [];
    if (/[\p{L}\p{N}]/u.test(joined)) out.push(ENDS_SENTENCE.test(joined) ? joined : `${joined}.`);
  };
  for (const raw of proseLines(text)) {
    const line = raw.replace(/^\s*(>\s*)+/, "");
    const block = /^\s*(#{1,6}\s+|[-*+]\s+|\d+[.)]\s+)/.exec(line);
    if (!line.trim()) {
      flush();
    } else if (block) {
      flush();
      paragraph.push(line.slice(block[0].length));
      if (block[1]?.startsWith("#")) flush();
    } else {
      paragraph.push(line);
    }
  }
  flush();
  return out;
}

/** A sentence too long to start playing soon is cut at commas, else at spaces */
function shorten(sentence: string): string[] {
  if (sentence.length <= SENTENCE_MAX_CHARS) return [sentence];
  const parts: string[] = [];
  let rest = sentence;
  while (rest.length > SENTENCE_MAX_CHARS) {
    const window = rest.slice(0, SENTENCE_MAX_CHARS);
    const comma = window.lastIndexOf(", ");
    const space = window.lastIndexOf(" ");
    const cut = comma > SENTENCE_MAX_CHARS / 3 ? comma + 1 : space > 0 ? space : SENTENCE_MAX_CHARS;
    parts.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) parts.push(rest);
  return parts;
}

function capped(sentences: string[], maxChars: number): string[] {
  const out: string[] = [];
  let used = 0;
  for (const sentence of sentences) {
    const room = maxChars - used;
    if (room <= 0) break;
    if (sentence.length <= room) {
      out.push(sentence);
      used += sentence.length + 1;
      continue;
    }
    const cut = sentence.slice(0, room).replace(/\s+\S*$/, "");
    if (/[\p{L}\p{N}]/u.test(cut)) out.push(`${cut.replace(/[,;:]$/, "")}.`);
    break;
  }
  return out;
}

/** The reply's prose split into sentences, at most `maxChars` in all; empty when nothing reads */
export function speechSentences(markdown: string, maxChars = SPEECH_MAX_CHARS): string[] {
  const sentences = units(markdown)
    .flatMap((unit) => unit.split(/(?<=[.!?…])\s+(?=\S)/))
    .map((s) => s.trim())
    .filter((s) => /[\p{L}\p{N}]/u.test(s))
    .flatMap(shorten);
  return capped(sentences, maxChars);
}
