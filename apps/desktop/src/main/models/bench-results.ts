import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { BENCH_RESULTS_MAX_RUNS, type LocalBenchRun } from "@exegol/shared";
import { z } from "zod";

/** Written by scripts/dictation-bench.ts --save, read by Settings > Models. Scores only: no text */
export const BENCH_RESULTS_DIR = join(homedir(), ".exegol", "dictation-bench");
export const BENCH_RESULTS_FILE = join(BENCH_RESULTS_DIR, "results.json");

const pct = z.number().min(0);
const runSchema = z.object({
  runAt: z.string().min(1),
  clips: z.number().int().min(0),
  audioSeconds: z.number().min(0),
  language: z.string().min(1).max(8),
  vocabulary: z.object({ terms: z.number().int().min(0), hash: z.string().max(64) }).optional(),
  models: z.array(
    z.object({
      modelId: z.string().min(1).max(200),
      werPercent: pct,
      cerPercent: pct,
      rtf: z.number().min(0),
      decodeSeconds: z.number().min(0),
      clips: z.number().int().min(0),
      correctedClips: z.number().int().min(0),
      selfScoredClips: z.number().int().min(0),
      reference: z.enum(["corrected", "saved-text"]),
    }),
  ),
}) satisfies z.ZodType<LocalBenchRun>;

const fileSchema = z.object({ version: z.literal(1), runs: z.array(runSchema) });
export type BenchResultsFile = z.infer<typeof fileSchema>;

/** Unreadable or foreign content counts as no runs: the file is a dev convenience */
export function parseBenchResults(text: string | null): BenchResultsFile {
  if (!text) return { version: 1, runs: [] };
  try {
    const parsed = fileSchema.safeParse(JSON.parse(text));
    if (parsed.success) return parsed.data;
  } catch {}
  return { version: 1, runs: [] };
}

export function mergeBenchRun(file: BenchResultsFile, run: LocalBenchRun): BenchResultsFile {
  return { version: 1, runs: [...file.runs, run].slice(-BENCH_RESULTS_MAX_RUNS) };
}

/** The newest run per language, newest first */
export function latestRunsByLanguage(file: BenchResultsFile): LocalBenchRun[] {
  const seen = new Map<string, LocalBenchRun>();
  const sorted = [...file.runs].sort((a, b) => b.runAt.localeCompare(a.runAt));
  for (const run of sorted) if (!seen.has(run.language)) seen.set(run.language, run);
  return [...seen.values()];
}

export async function readLatestBenchRuns(path = BENCH_RESULTS_FILE): Promise<LocalBenchRun[]> {
  const text = await readFile(path, "utf8").catch(() => null);
  return latestRunsByLanguage(parseBenchResults(text));
}
