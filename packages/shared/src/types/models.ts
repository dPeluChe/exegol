/** Local speech-to-text models (Settings > Models) and Exegol's disk use (Settings > Storage) */

export type SpeechEngine = "sherpa-onnx";
export type SpeechModelKind = "offline" | "streaming";

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
  /** The archive as downloaded */
  sizeBytes: number;
  /** On disk once extracted */
  installedBytes: number;
  license: string;
  attribution: string;
  sourceUrl: string;
  sha256: string;
  archive: "tar.bz2";
  /** The archive's single top-level folder */
  rootDir: string;
  /** Files the engine needs, relative to rootDir: all present means ready */
  files: string[];
  notes?: string;
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

export const DEFAULT_SPEECH_MODEL_KEY = "speechDefaultModel";

export type StorageCategory =
  | "models"
  | "scrollback"
  | "screenshots"
  | "logs"
  | "database"
  | "worktrees"
  | "browser"
  | "other";

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

export interface StorageReport {
  rows: StorageRow[];
  totalBytes: number;
  browserPartitions: BrowserPartitionUsage[];
  freeBytes: number | null;
  diskBytes: number | null;
  computedAt: number;
}
