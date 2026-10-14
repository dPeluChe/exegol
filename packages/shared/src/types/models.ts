/** Local speech-to-text models (Settings > Models) and Exegol's disk use (Settings > Storage) */

export type SpeechEngine = "sherpa-onnx";
export type SpeechModelKind = "offline" | "streaming";

/** A published score for a model, copied from the source as it reads there (never estimated) */
export interface PublicBenchmark {
  language: "es" | "en";
  werPercent: number;
  /** Times faster than real time on CPU; absent when the source gives none */
  speedX?: number;
  dataset: string;
  source: string;
  url: string;
  note?: string;
}

export interface SpeechModelEntry {
  id: string;
  name: string;
  engine: SpeechEngine;
  /** False when the engine cannot run it yet: listed as "coming", no download */
  engineAvailable: boolean;
  kind: SpeechModelKind;
  /** ISO 639 codes; empty when `languageSummary` covers a list too long to keep */
  languages: string[];
  languageSummary?: string;
  /** One line for the picker: what this model is good at */
  bestFor: string;
  /** Position in the dictation overlay's short list of recommended models (1 = recommended) */
  featured?: number;
  /** The archive as downloaded */
  sizeBytes: number;
  /** On disk once extracted */
  installedBytes: number;
  license: string;
  /** False when the license forbids commercial use: warned, confirmed, never the default on its own */
  commercialUse?: boolean;
  attribution: string;
  sourceUrl: string;
  sha256: string;
  archive: "tar.bz2";
  /** The archive's single top-level folder */
  rootDir: string;
  /** Files the engine needs, relative to rootDir: all present means ready */
  files: string[];
  notes?: string;
  benchmarks?: PublicBenchmark[];
}

export type ModelStatus =
  | { state: "not_downloaded"; partialBytes: number }
  | { state: "downloading"; receivedBytes: number; totalBytes: number }
  | { state: "verifying" }
  | { state: "extracting" }
  | { state: "ready"; diskBytes: number }
  | { state: "failed"; error: string; partialBytes: number };

export interface ModelListItem extends SpeechModelEntry {
  status: ModelStatus;
  isDefault: boolean;
}

/** Pushed on `models:progress` whenever a model's status changes */
export interface ModelProgressEvent {
  id: string;
  status: ModelStatus;
}

/** One model in a local bench run (`dictation-bench.ts --save`). `correctedClips` had a human
 *  `reference`; the rest were scored against the saved text, and `selfScoredClips` of those were
 *  dictated with this same model, which biases its WER toward 0 */
export interface LocalBenchModel {
  modelId: string;
  werPercent: number;
  cerPercent: number;
  rtf: number;
  decodeSeconds: number;
  clips: number;
  correctedClips: number;
  selfScoredClips: number;
  /** "corrected" only when every clip had a human reference */
  reference: "corrected" | "saved-text";
}

export interface LocalBenchRun {
  runAt: string;
  clips: number;
  audioSeconds: number;
  language: string;
  vocabulary?: { terms: number; hash: string };
  models: LocalBenchModel[];
}

export const BENCH_RESULTS_MAX_RUNS = 20;

export const DEFAULT_SPEECH_MODEL_KEY = "speechDefaultModel";

export const STORAGE_CATEGORIES = [
  "models",
  "scrollback",
  "screenshots",
  "recordings",
  "logs",
  "database",
  "worktrees",
  "browser",
  "other",
] as const;

export type StorageCategory = (typeof STORAGE_CATEGORIES)[number];

export interface StorageRow {
  category: StorageCategory;
  label: string;
  bytes: number;
  /** The folder "Open folder" reveals, null when it does not exist */
  path: string | null;
}

export interface BrowserPartitionUsage {
  projectId: string;
  projectName: string;
  bytes: number;
  cacheBytes: number;
}

export const STORAGE_ROOTS = ["exegol", "userData"] as const;
export type StorageRoot = (typeof STORAGE_ROOTS)[number];

/** A top-level file or folder of ~/.exegol or userData that no category counts */
export interface StorageOtherEntry {
  root: StorageRoot;
  name: string;
  bytes: number;
  isDir: boolean;
}

export interface StorageReport {
  rows: StorageRow[];
  totalBytes: number;
  browserPartitions: BrowserPartitionUsage[];
  /** What "Other" holds, largest first */
  otherEntries: StorageOtherEntry[];
  freeBytes: number | null;
  diskBytes: number | null;
  computedAt: number;
}
