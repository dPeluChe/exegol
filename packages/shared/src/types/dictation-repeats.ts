/** A word or short phrase the engine wrote 3+ times in a row becomes one: a boosted vocabulary
 *  term can fill a filler or a silence with itself. Two in a row ("no no") stay */

const MAX_PHRASE_WORDS = 3;
const MIN_REPEATS = 3;

interface Word {
  start: number;
  end: number;
  raw: string;
  key: string;
}

const TRAILING_MARKS = /[^\p{L}\p{N}]+$/u;

export function collapseRepeats(text: string): { text: string; collapsed: number } {
  const words: Word[] = [...text.matchAll(/\S+/g)].map((m) => ({
    start: m.index ?? 0,
    end: (m.index ?? 0) + m[0].length,
    raw: m[0],
    key: m[0].toLowerCase().replace(/[^\p{L}\p{N}]/gu, ""),
  }));
  const same = (a: number, b: number, n: number) => {
    for (let j = 0; j < n; j++) {
      if (words[a + j]?.key !== words[b + j]?.key) return false;
    }
    return true;
  };
  let out = "";
  let pos = 0;
  let collapsed = 0;
  let i = 0;
  while (i < words.length) {
    let run: { n: number; k: number } | null = null;
    for (let n = 1; n <= MAX_PHRASE_WORDS && !run; n++) {
      if (words.slice(i, i + n).some((w) => !w.key) || i + n > words.length) continue;
      let k = 1;
      while (same(i, i + k * n, n)) k++;
      if (k >= MIN_REPEATS) run = { n, k };
    }
    if (!run) {
      i++;
      continue;
    }
    const firstEnd = words[i + run.n - 1] as Word;
    const last = words[i + run.k * run.n - 1] as Word;
    // The first occurrence as written, ending with the last one's punctuation
    out +=
      text.slice(pos, firstEnd.start) +
      firstEnd.raw.replace(TRAILING_MARKS, "") +
      (TRAILING_MARKS.exec(last.raw)?.[0] ?? "");
    pos = last.end;
    collapsed++;
    i += run.k * run.n;
  }
  return { text: out + text.slice(pos), collapsed };
}
