import { mkdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { Worker } from "node:worker_threads";
import type { ModelListItem, ModelStatus, SpeechModelEntry } from "@exegol/shared";
import { net } from "electron";
import { broadcast } from "../lib/event-bus";
import { logger } from "../lib/logger";
import { invalidateStorageReport } from "../system/storage";
import { EXEGOL_DIR } from "../terminal/pty-sidecar-protocol";
import { findModel, MODEL_CATALOG } from "./catalog";
import { downloadVerified, fileSize } from "./download";
import type { extractTarBz2 } from "./extract";

export const MODELS_DIR = join(EXEGOL_DIR, "models");
const PARTIAL_DIR = join(MODELS_DIR, ".partial");
const PROGRESS_INTERVAL_MS = 250;

export const modelDir = (id: string) => join(MODELS_DIR, id);
const partialPath = (id: string) => join(PARTIAL_DIR, `${id}.tar.bz2`);

interface Job {
  abort: AbortController;
  worker: Worker | null;
  status: ModelStatus;
}

const jobs = new Map<string, Job>();
const failures = new Map<string, string>();

function push(id: string, status: ModelStatus): void {
  broadcast("models:progress", { id, status });
}

async function isInstalled(entry: SpeechModelEntry): Promise<boolean> {
  for (const file of entry.files) {
    const info = await stat(join(modelDir(entry.id), file)).catch(() => null);
    if (!info?.isFile()) return false;
  }
  return true;
}

export async function modelStatus(entry: SpeechModelEntry): Promise<ModelStatus> {
  const job = jobs.get(entry.id);
  if (job) return job.status;
  if (await isInstalled(entry)) return { state: "ready", diskBytes: entry.installedBytes };
  const partialBytes = await fileSize(partialPath(entry.id));
  const error = failures.get(entry.id);
  return error
    ? { state: "failed", error, partialBytes }
    : { state: "not_downloaded", partialBytes };
}

export async function listModels(defaultId: string): Promise<ModelListItem[]> {
  return Promise.all(
    MODEL_CATALOG.map(async (entry) => ({
      ...entry,
      status: await modelStatus(entry),
      isDefault: entry.id === defaultId,
    })),
  );
}

function extractInWorker(job: Job, data: Parameters<typeof extractTarBz2>[0]): Promise<void> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(join(__dirname, "model-extract-worker.js"), { workerData: data });
    job.worker = worker;
    worker.once("message", (msg: { ok: boolean; error?: string }) =>
      msg.ok ? resolve() : reject(new Error(msg.error)),
    );
    worker.once("error", reject);
    worker.once("exit", (code) => {
      if (code !== 0) reject(new Error("extraction stopped"));
    });
  });
}

/** Starts (or resumes) a download; resolves when it ends, never throws */
export async function downloadModel(id: string): Promise<void> {
  const entry = findModel(id);
  if (!entry || !entry.engineAvailable || jobs.has(id)) return;
  const job: Job = {
    abort: new AbortController(),
    worker: null,
    status: { state: "downloading", receivedBytes: 0, totalBytes: entry.sizeBytes },
  };
  jobs.set(id, job);
  failures.delete(id);
  const set = (status: ModelStatus) => {
    job.status = status;
    push(id, status);
  };

  let lastPush = 0;
  try {
    await mkdir(PARTIAL_DIR, { recursive: true });
    set({
      state: "downloading",
      receivedBytes: await fileSize(partialPath(id)),
      totalBytes: entry.sizeBytes,
    });
    await downloadVerified({
      url: entry.sourceUrl,
      dest: partialPath(id),
      expectedBytes: entry.sizeBytes,
      sha256: entry.sha256,
      signal: job.abort.signal,
      fetchImpl: (url, init) => net.fetch(url, init),
      onProgress: (receivedBytes, totalBytes) => {
        job.status = { state: "downloading", receivedBytes, totalBytes };
        const now = Date.now();
        if (now - lastPush < PROGRESS_INTERVAL_MS) return;
        lastPush = now;
        push(id, job.status);
      },
      onVerifying: () => set({ state: "verifying" }),
    });
    set({ state: "extracting" });
    await extractInWorker(job, {
      archive: partialPath(id),
      tmpDir: join(MODELS_DIR, `.tmp-${id}`),
      destDir: modelDir(id),
      rootDir: entry.rootDir,
      requiredFiles: entry.files,
    });
    await rm(partialPath(id), { force: true });
    logger.info(`[Models] installed ${id}`);
  } catch (err) {
    if (!job.abort.signal.aborted) {
      const message = err instanceof Error ? err.message : String(err);
      failures.set(id, message);
      logger.warn(`[Models] ${id} failed: ${message}`);
    }
  } finally {
    jobs.delete(id);
    invalidateStorageReport();
    await rm(join(MODELS_DIR, `.tmp-${id}`), { recursive: true, force: true }).catch(() => {});
    push(id, await modelStatus(entry));
  }
}

/** Stops a download (the partial file stays for a later resume) or an extraction */
export function cancelModel(id: string): void {
  const job = jobs.get(id);
  if (!job) return;
  job.abort.abort();
  void job.worker?.terminate();
}

/** Removes the installed model and any partial download */
export async function deleteModel(id: string): Promise<void> {
  const entry = findModel(id);
  if (!entry) return;
  cancelModel(id);
  failures.delete(id);
  await rm(modelDir(id), { recursive: true, force: true });
  await rm(partialPath(id), { force: true });
  invalidateStorageReport();
  push(id, await modelStatus(entry));
}
