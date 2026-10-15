import type { DictationRecordingsSummary, DictationTargetKind } from "@exegol/shared";

const DAY_MS = 86_400_000;
const PROJECT_DIR = /^[A-Za-z0-9_-]{1,64}$/;
export const NO_PROJECT_DIR = "no-project";

/** The .json written next to each .wav. Never logged: `text` and `rawText` are dictated words */
export interface RecordingMeta {
  version: 1;
  createdAt: string;
  durationMs: number;
  audio: string;
  projectId: string | null;
  projectName: string | null;
  target: DictationTargetKind;
  modelId: string;
  model: { archive: string | null; sha256: string | null };
  engine: { name: "sherpa-onnx"; version: string | null };
  language: string | null;
  transcribeMs: number;
  historyId: string | null;
  text: string;
  rawText?: string;
  /** Terms the dictation had (count and hash, never the words); `applied`: the model used them */
  vocabulary?: { terms: number; hash: string; applied: boolean };
}

/** 16-bit PCM mono WAV: what sherpa-onnx and any audio tool read */
export function encodeWav(chunks: readonly Float32Array[], sampleRate: number): Buffer {
  const samples = chunks.reduce((n, c) => n + c.length, 0);
  const out = Buffer.alloc(44 + samples * 2);
  out.write("RIFF", 0, "ascii");
  out.writeUInt32LE(36 + samples * 2, 4);
  out.write("WAVE", 8, "ascii");
  out.write("fmt ", 12, "ascii");
  out.writeUInt32LE(16, 16);
  out.writeUInt16LE(1, 20);
  out.writeUInt16LE(1, 22);
  out.writeUInt32LE(sampleRate, 24);
  out.writeUInt32LE(sampleRate * 2, 28);
  out.writeUInt16LE(2, 32);
  out.writeUInt16LE(16, 34);
  out.write("data", 36, "ascii");
  out.writeUInt32LE(samples * 2, 40);
  let offset = 44;
  for (const chunk of chunks) {
    for (const s of chunk) {
      const clamped = Math.max(-1, Math.min(1, s));
      out.writeInt16LE(Math.round(clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff), offset);
      offset += 2;
    }
  }
  return out;
}

/** A 16-bit PCM WAV back to samples; null for any other format */
export function decodeWav(buf: Buffer): { samples: Float32Array; sampleRate: number } | null {
  if (buf.length < 12 || buf.toString("ascii", 0, 4) !== "RIFF") return null;
  if (buf.toString("ascii", 8, 12) !== "WAVE") return null;
  let offset = 12;
  let sampleRate = 0;
  let pcm16 = false;
  while (offset + 8 <= buf.length) {
    const id = buf.toString("ascii", offset, offset + 4);
    const size = buf.readUInt32LE(offset + 4);
    const body = offset + 8;
    if (id === "fmt ") {
      pcm16 =
        buf.readUInt16LE(body) === 1 &&
        buf.readUInt16LE(body + 2) === 1 &&
        buf.readUInt16LE(body + 14) === 16;
      sampleRate = buf.readUInt32LE(body + 4);
    } else if (id === "data") {
      if (!pcm16 || !sampleRate) return null;
      const count = Math.floor(Math.min(size, buf.length - body) / 2);
      const samples = new Float32Array(count);
      for (let i = 0; i < count; i++) samples[i] = buf.readInt16LE(body + i * 2) / 0x8000;
      return { samples, sampleRate };
    }
    offset = body + size + (size % 2);
  }
  return null;
}

/** A project id only names a folder when it is a plain id */
export const projectDirName = (projectId: string | null): string =>
  projectId && projectId !== NO_PROJECT_DIR && PROJECT_DIR.test(projectId)
    ? projectId
    : NO_PROJECT_DIR;

/** `2026-10-14T09-05-03.120Z-ab12cd`: sortable, no colons (Finder shows them as slashes) */
export const recordingBaseName = (at: Date, id: string): string =>
  `${at.toISOString().replaceAll(":", "-")}-${id.slice(0, 6)}`;

/** A recording is its base name; the .wav and .json beside it are one */
export const recordingStem = (name: string): string | null =>
  name.endsWith(".wav") || name.endsWith(".json") ? name.slice(0, name.lastIndexOf(".")) : null;

export interface RecordingFile {
  project: string;
  name: string;
  bytes: number;
  mtimeMs: number;
}

/** Files of recordings older than `days`: a pair goes as one, dated by its newest file */
export function expiredRecordings(
  files: readonly RecordingFile[],
  days: number,
  now = Date.now(),
): RecordingFile[] {
  const newest = new Map<string, number>();
  for (const f of files) {
    const stem = recordingStem(f.name);
    if (!stem) continue;
    const key = `${f.project}/${stem}`;
    newest.set(key, Math.max(newest.get(key) ?? 0, f.mtimeMs));
  }
  const cutoff = now - days * DAY_MS;
  return files.filter((f) => {
    const stem = recordingStem(f.name);
    return stem !== null && (newest.get(`${f.project}/${stem}`) ?? now) < cutoff;
  });
}

export function summarizeRecordings(
  files: readonly RecordingFile[],
  projectName: (id: string) => string | null,
): DictationRecordingsSummary {
  const byProject = new Map<string, { stems: Set<string>; bytes: number }>();
  for (const f of files) {
    const stem = recordingStem(f.name);
    if (!stem) continue;
    const entry = byProject.get(f.project) ?? { stems: new Set(), bytes: 0 };
    entry.stems.add(stem);
    entry.bytes += f.bytes;
    byProject.set(f.project, entry);
  }
  const projects = [...byProject].map(([dir, { stems, bytes }]) => {
    const projectId = dir === NO_PROJECT_DIR ? null : dir;
    return {
      projectId,
      projectName: projectId ? projectName(projectId) : null,
      count: stems.size,
      bytes,
    };
  });
  projects.sort((a, b) => b.bytes - a.bytes);
  return {
    count: projects.reduce((n, p) => n + p.count, 0),
    bytes: projects.reduce((n, p) => n + p.bytes, 0),
    projects,
  };
}
