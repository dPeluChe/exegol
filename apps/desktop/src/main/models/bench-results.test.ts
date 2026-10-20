import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BENCH_RESULTS_MAX_RUNS, type LocalBenchRun } from "@exegol/shared";
import { describe, expect, it } from "vitest";
import {
  latestRunsByLanguage,
  mergeBenchRun,
  parseBenchResults,
  readLatestBenchRuns,
} from "./bench-results";

const run = (runAt: string, language = "es"): LocalBenchRun => ({
  runAt,
  clips: 3,
  audioSeconds: 12.5,
  language,
  models: [
    {
      modelId: "parakeet-tdt-0.6b-v3-int8",
      werPercent: 8.1,
      cerPercent: 3,
      rtf: 0.06,
      decodeSeconds: 0.8,
      clips: 3,
      correctedClips: 2,
      selfScoredClips: 1,
      reference: "saved-text",
    },
  ],
});

describe("bench results file", () => {
  it("keeps only the last runs", () => {
    let file = parseBenchResults(null);
    for (let i = 0; i < BENCH_RESULTS_MAX_RUNS + 5; i++) {
      file = mergeBenchRun(file, run(`2026-10-14T10:${String(i).padStart(2, "0")}:00Z`));
    }
    expect(file.runs).toHaveLength(BENCH_RESULTS_MAX_RUNS);
    expect(file.runs[0]?.runAt).toBe("2026-10-14T10:05:00Z");
    expect(file.runs.at(-1)?.runAt).toBe("2026-10-14T10:24:00Z");
  });

  it("treats broken or foreign content as empty", () => {
    expect(parseBenchResults("{nope").runs).toEqual([]);
    expect(parseBenchResults(JSON.stringify({ version: 2, runs: [] })).runs).toEqual([]);
    expect(parseBenchResults(JSON.stringify({ version: 1, runs: [{ runAt: 1 }] })).runs).toEqual(
      [],
    );
  });

  it("returns the newest run per language", () => {
    let file = parseBenchResults(null);
    file = mergeBenchRun(file, run("2026-10-12T00:00:00Z", "es"));
    file = mergeBenchRun(file, run("2026-10-13T00:00:00Z", "en"));
    file = mergeBenchRun(file, run("2026-10-14T00:00:00Z", "es"));
    expect(latestRunsByLanguage(file).map((r) => `${r.language}@${r.runAt.slice(0, 10)}`)).toEqual([
      "es@2026-10-14",
      "en@2026-10-13",
    ]);
  });

  it("reads the file, or nothing when it is missing", async () => {
    const dir = mkdtempSync(join(tmpdir(), "exegol-bench-results-"));
    const path = join(dir, "results.json");
    expect(await readLatestBenchRuns(path)).toEqual([]);
    writeFileSync(path, JSON.stringify(mergeBenchRun(parseBenchResults(null), run("2026-10-14"))));
    expect((await readLatestBenchRuns(path))[0]?.models[0]?.correctedClips).toBe(2);
  });
});
