import type { Dirent } from "node:fs";
import { chmod, lstat, mkdir, readdir, rm, unlink, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
import {
  DICTATION_SAMPLE_RATE,
  type DictationRecordingsSummary,
  type DictationTargetKind,
} from "@exegol/shared";
import { createLimiter, mapWithConcurrency } from "../lib/concurrency";
import { logger } from "../lib/logger";
import { findModel } from "../models/catalog";
import { EXEGOL_DIR } from "../terminal/pty-sidecar-protocol";
import {
  encodeWav,
  expiredRecordings,
  projectDirName,
  type RecordingFile,
  type RecordingMeta,
  recordingBaseName,
  recordingStem,
  summarizeRecordings,
} from "./recording-files";
import type { VocabularyInfo } from "./vocabulary";

export const RECORDINGS_DIR = join(EXEGOL_DIR, "dictation-audio");
const fsLimit = createLimiter(16);

let engineVersion: string | null | undefined;
function sherpaVersion(): string | null {
  if (engineVersion === undefined) {
    try {
      engineVersion = createRequire(__filename)("sherpa-onnx-node/package.json").version ?? null;
    } catch {
      engineVersion = null;
    }
  }
  return engineVersion ?? null;
}

/** One dictation's audio while it records: main keeps it, capped at the longest dictation */
export class RecordingBuffer {
  readonly chunks: Float32Array[] = [];
  private room: number;
  constructor(maxSeconds: number) {
    this.room = maxSeconds * DICTATION_SAMPLE_RATE;
  }
  push(samples: Float32Array): void {
    if (this.room <= 0) return;
    const kept = samples.length > this.room ? samples.slice(0, this.room) : samples;
    this.room -= kept.length;
    this.chunks.push(kept);
  }
  get samples(): number {
    return this.chunks.reduce((n, c) => n + c.length, 0);
  }
}

export interface SaveRecordingInput {
  sessionId: string;
  audio: RecordingBuffer;
  at: Date;
  projectId: string | null;
  projectName: string | null;
  target: DictationTargetKind;
  modelId: string;
  transcribeMs: number;
  historyId: string | null;
  text: string;
  rawText: string;
  vocabulary: VocabularyInfo | null;
}

/** Writes the .wav and its .json; never throws, never logs what was said */
export async function saveRecording(input: SaveRecordingInput): Promise<void> {
  try {
    const project = projectDirName(input.projectId);
    const dir = join(RECORDINGS_DIR, project);
    await mkdir(dir, { recursive: true, mode: 0o700 });
    await Promise.all([chmod(RECORDINGS_DIR, 0o700), chmod(dir, 0o700)]);
    const base = recordingBaseName(input.at, input.sessionId);
    const entry = findModel(input.modelId);
    const meta: RecordingMeta = {
      version: 1,
      createdAt: input.at.toISOString(),
      durationMs: Math.round((input.audio.samples / DICTATION_SAMPLE_RATE) * 1000),
      audio: `${project}/${base}.wav`,
      projectId: input.projectId,
      projectName: input.projectName,
      target: input.target,
      modelId: input.modelId,
      model: { archive: entry?.rootDir ?? null, sha256: entry?.sha256 ?? null },
      engine: { name: "sherpa-onnx", version: sherpaVersion() },
      language: entry?.languages.length === 1 ? (entry.languages[0] ?? null) : null,
      transcribeMs: input.transcribeMs,
      historyId: input.historyId,
      text: input.text,
      ...(input.rawText !== input.text ? { rawText: input.rawText } : {}),
      ...(input.vocabulary ? { vocabulary: input.vocabulary } : {}),
    };
    await writeFile(
      join(dir, `${base}.wav`),
      encodeWav(input.audio.chunks, DICTATION_SAMPLE_RATE),
      { mode: 0o600 },
    );
    await writeFile(join(dir, `${base}.json`), `${JSON.stringify(meta, null, 2)}\n`, {
      mode: 0o600,
    });
  } catch (err) {
    const reason = (err as NodeJS.ErrnoException)?.code ?? "write failed";
    logger.warn(`[Dictation] recording not saved: ${reason}`);
  }
}

/** Every recording file, one level of project folders deep; links are skipped */
async function listRecordingFiles(): Promise<RecordingFile[]> {
  const projects: Dirent[] = await readdir(RECORDINGS_DIR, { withFileTypes: true }).catch(() => []);
  const lists = await mapWithConcurrency(
    projects.filter((p) => p.isDirectory()),
    4,
    async (p) => {
      const dir = join(RECORDINGS_DIR, p.name);
      const names: Dirent[] = await fsLimit(() => readdir(dir, { withFileTypes: true })).catch(
        () => [],
      );
      const files = await mapWithConcurrency(
        names.filter((n) => n.isFile()),
        8,
        async (n) => {
          const info = await fsLimit(() => lstat(join(dir, n.name))).catch(() => null);
          return info?.isFile()
            ? { project: p.name, name: n.name, bytes: info.size, mtimeMs: info.mtimeMs }
            : null;
        },
      );
      return files.filter((f): f is RecordingFile => f !== null);
    },
  );
  return lists.flat();
}

export async function recordingsSummary(
  projectName: (id: string) => string | null,
): Promise<DictationRecordingsSummary> {
  return summarizeRecordings(await listRecordingFiles(), projectName);
}

/** Drops recordings past the retention; whether keeping is on or off */
export async function sweepRecordings(days: number, now = Date.now()): Promise<number> {
  const expired = expiredRecordings(await listRecordingFiles(), days, now);
  await mapWithConcurrency(expired, 8, (f) =>
    unlink(join(RECORDINGS_DIR, f.project, f.name)).catch(() => {}),
  );
  const removed = new Set(expired.map((f) => `${f.project}/${recordingStem(f.name)}`));
  if (removed.size > 0) logger.info(`[Dictation] removed ${removed.size} expired recording(s)`);
  return removed.size;
}

/** Deletes every recording; the folder stays */
export async function clearRecordings(): Promise<void> {
  const names = await readdir(RECORDINGS_DIR).catch(() => [] as string[]);
  await Promise.all(
    names.map((n) => rm(join(RECORDINGS_DIR, n), { force: true, recursive: true })),
  );
}

/** For "Open folder": created (0700) so there is something to open */
export async function ensureRecordingsDir(): Promise<string> {
  await mkdir(RECORDINGS_DIR, { recursive: true, mode: 0o700 });
  return RECORDINGS_DIR;
}
