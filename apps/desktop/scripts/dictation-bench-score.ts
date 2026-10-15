// Pure parts of dictation-bench.ts: text normalization, edit distance, WER/CER, per-model rows
import type { LocalBenchModel } from "@exegol/shared";

/** Case and punctuation do not count: lowercase, anything but letters and digits is a space */
export function normalizeText(text: string): string {
  return text
    .normalize("NFC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/** Levenshtein distance over any sequence (words or characters), two rows of memory */
export function editDistance<T>(a: readonly T[], b: readonly T[]): number {
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      row[j] = Math.min((prev[j] ?? 0) + 1, (row[j - 1] ?? 0) + 1, (prev[j - 1] ?? 0) + cost);
    }
    prev = row;
  }
  return prev[b.length] ?? 0;
}

const rate = (errors: number, length: number, hypLength: number) =>
  length === 0 ? (hypLength === 0 ? 0 : 1) : errors / length;

export function wordErrorRate(reference: string, hypothesis: string): number {
  const ref = normalizeText(reference).split(" ").filter(Boolean);
  const hyp = normalizeText(hypothesis).split(" ").filter(Boolean);
  return rate(editDistance(ref, hyp), ref.length, hyp.length);
}

export function charErrorRate(reference: string, hypothesis: string): number {
  const ref = [...normalizeText(reference)];
  const hyp = [...normalizeText(hypothesis)];
  return rate(editDistance(ref, hyp), ref.length, hyp.length);
}

export interface ClipResult {
  clip: string;
  audioSec: number;
  decodeSec: number;
  wer: number;
  cer: number;
  reference: string;
  hypothesis: string;
  /** The recording had a human `reference`, not only the saved text */
  corrected: boolean;
  /** The model that dictated it (its `modelId`) */
  dictatedWith: string | null;
}

export interface ModelRow {
  model: string;
  clips: number;
  meanWer: number;
  meanCer: number;
  audioSec: number;
  decodeSec: number;
  rtf: number;
}

export function summarizeModel(model: string, clips: readonly ClipResult[]): ModelRow {
  const sum = (pick: (c: ClipResult) => number) => clips.reduce((n, c) => n + pick(c), 0);
  const mean = (pick: (c: ClipResult) => number) => (clips.length ? sum(pick) / clips.length : 0);
  const audioSec = sum((c) => c.audioSec);
  const decodeSec = sum((c) => c.decodeSec);
  return {
    model,
    clips: clips.length,
    meanWer: mean((c) => c.wer),
    meanCer: mean((c) => c.cer),
    audioSec,
    decodeSec,
    rtf: audioSec > 0 ? decodeSec / audioSec : 0,
  };
}

export function formatTable(rows: readonly ModelRow[]): string {
  const header = ["model", "clips", "WER %", "CER %", "audio s", "decode s", "RTF"];
  const body = rows.map((r) => [
    r.model,
    String(r.clips),
    (r.meanWer * 100).toFixed(1),
    (r.meanCer * 100).toFixed(1),
    r.audioSec.toFixed(1),
    r.decodeSec.toFixed(1),
    r.rtf.toFixed(3),
  ]);
  const widths = header.map((h, i) =>
    Math.max(h.length, ...body.map((row) => row[i]?.length ?? 0)),
  );
  const line = (cells: string[]) =>
    cells
      .map((c, i) => (i === 0 ? c.padEnd(widths[i] ?? 0) : c.padStart(widths[i] ?? 0)))
      .join("  ");
  return [line(header), line(widths.map((w) => "-".repeat(w))), ...body.map(line)].join("\n");
}

/** A model's line in results.json: its row plus how trustworthy the references were */
export function localBenchModel(modelId: string, results: readonly ClipResult[]): LocalBenchModel {
  const row = summarizeModel(modelId, results);
  const correctedClips = results.filter((c) => c.corrected).length;
  const round = (n: number, digits: number) => Number(n.toFixed(digits));
  return {
    modelId,
    werPercent: round(row.meanWer * 100, 2),
    cerPercent: round(row.meanCer * 100, 2),
    rtf: round(row.rtf, 4),
    decodeSeconds: round(row.decodeSec, 2),
    clips: row.clips,
    correctedClips,
    selfScoredClips: results.filter((c) => !c.corrected && c.dictatedWith === modelId).length,
    reference: row.clips > 0 && correctedClips === row.clips ? "corrected" : "saved-text",
  };
}
