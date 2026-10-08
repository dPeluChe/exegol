import { mkdir, rm, stat, statfs } from "node:fs/promises";
import { join } from "node:path";
import type { ModelListItem, ModelStatus, SpeechModelEntry } from "@exegol/shared";
import { net } from "electron";
import { broadcast } from "../lib/event-bus";
import { logger } from "../lib/logger";
import { redact } from "../system/diagnostics";
import { invalidateStorageReport } from "../system/storage";
import { EXEGOL_DIR } from "../terminal/pty-sidecar-protocol";
import { findModel, MODEL_CATALOG } from "./catalog";
import { downloadVerified, fileSize } from "./download";
import { extractTarBz2, pruneToRequired } from "./extract";

export const MODELS_DIR = join(EXEGOL_DIR, "models");
const PARTIAL_DIR = join(MODELS_DIR, ".partial");
const PROGRESS_INTERVAL_MS = 250;
const FREE_SPACE_MARGIN = 256 * 1024 * 1024;

export const modelDir = (id: string) => join(MODELS_DIR, id);
const partialPath = (id: string) => join(PARTIAL_DIR, `${id}.tar.bz2`);

interface Job {
  abort: AbortController;
  status: ModelStatus;
  done: Promise<void>;
}

const jobs = new Map<string, Job>();
const failures = new Map<string, string>();
/** Installed models whose folder was checked for extras this run */
const pruned = new Set<string>();

const mb = (bytes: number) => (bytes / 1024 ** 2).toFixed(1);

/** Models installed before extraction kept only the required files lose their extras once */
function pruneInstalled(entry: SpeechModelEntry): void {
  if (pruned.has(entry.id) || jobs.has(entry.id)) return;
  pruned.add(entry.id);
  pruneToRequired(modelDir(entry.id), entry.files)
    .then((removed) => {
      if (removed.length === 0) return;
      logger.info(`[Models] ${entry.id}: removed ${removed.length} files the engine never reads`);
      invalidateStorageReport();
    })
    .catch((err) => logger.warn(`[Models] ${entry.id}: cleanup failed: ${errorText(err)}`));
}

const errorText = (err: unknown) => redact(err instanceof Error ? err.message : String(err));

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
  if (await isInstalled(entry)) {
    pruneInstalled(entry);
    return { state: "ready", diskBytes: entry.installedBytes };
  }
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

/** Throws when the archive plus the unpacked model would not fit, with a margin */
async function assertFreeSpace(entry: SpeechModelEntry, partialBytes: number): Promise<void> {
  const fsInfo = await statfs(MODELS_DIR).catch(() => null);
  if (!fsInfo) return;
  const free = fsInfo.bavail * fsInfo.bsize;
  const needed = entry.sizeBytes - partialBytes + entry.installedBytes + FREE_SPACE_MARGIN;
  if (free < needed) {
    const gb = (n: number) => (n / 1024 ** 3).toFixed(1);
    throw new Error(`not enough disk space: needs ${gb(needed)} GB, ${gb(free)} GB free`);
  }
}

/** Starts (or resumes) a download; resolves when it ends, never throws */
export function downloadModel(id: string): Promise<void> {
  const entry = findModel(id);
  if (!entry || !entry.engineAvailable) return Promise.resolve();
  const running = jobs.get(id);
  if (running) return running.done;
  const job: Job = {
    abort: new AbortController(),
    status: { state: "downloading", receivedBytes: 0, totalBytes: entry.sizeBytes },
    done: Promise.resolve(),
  };
  jobs.set(id, job);
  job.done = runDownload(entry, job);
  return job.done;
}

async function runDownload(entry: SpeechModelEntry, job: Job): Promise<void> {
  const { id } = entry;
  failures.delete(id);
  const set = (status: ModelStatus) => {
    job.status = status;
    push(id, status);
  };

  let lastPush = 0;
  try {
    await mkdir(PARTIAL_DIR, { recursive: true });
    const partialBytes = await fileSize(partialPath(id));
    await assertFreeSpace(entry, partialBytes);
    logger.info(
      `[Models] download ${id}: ${mb(entry.sizeBytes)} MB${partialBytes > 0 ? `, resuming at ${mb(partialBytes)} MB` : ""}`,
    );
    const downloadStart = Date.now();
    let verifyStart = 0;
    set({ state: "downloading", receivedBytes: partialBytes, totalBytes: entry.sizeBytes });
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
      onVerifying: () => {
        verifyStart = Date.now();
        const secs = Math.max(0.001, (verifyStart - downloadStart) / 1000);
        const fetched = entry.sizeBytes - partialBytes;
        logger.info(
          `[Models] ${id}: downloaded ${mb(fetched)} MB in ${secs.toFixed(1)}s (${mb(fetched / secs)} MB/s)`,
        );
        set({ state: "verifying" });
      },
    });
    logger.info(`[Models] ${id}: sha256 ok in ${Date.now() - verifyStart}ms`);
    set({ state: "extracting" });
    const extractStart = Date.now();
    await extractTarBz2({
      archive: partialPath(id),
      signal: job.abort.signal,
      tmpDir: join(MODELS_DIR, `.tmp-${id}`),
      destDir: modelDir(id),
      rootDir: entry.rootDir,
      requiredFiles: entry.files,
    });
    await rm(partialPath(id), { force: true });
    pruned.add(id);
    logger.info(
      `[Models] installed ${id}: extracted in ${Date.now() - extractStart}ms, ${((Date.now() - downloadStart) / 1000).toFixed(1)}s in all`,
    );
  } catch (err) {
    if (job.abort.signal.aborted) {
      logger.info(`[Models] ${id}: cancelled`);
    } else {
      const message = err instanceof Error ? err.message : String(err);
      failures.set(id, message);
      logger.warn(`[Models] ${id} failed: ${errorText(err)}`);
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
  jobs.get(id)?.abort.abort();
}

/** Removes the installed model and any partial download */
export async function deleteModel(id: string): Promise<void> {
  const entry = findModel(id);
  if (!entry) return;
  const job = jobs.get(id);
  job?.abort.abort();
  // The job's own cleanup must finish first, or it could write after the rm
  await job?.done;
  failures.delete(id);
  await rm(modelDir(id), { recursive: true, force: true });
  await rm(partialPath(id), { force: true });
  invalidateStorageReport();
  push(id, await modelStatus(entry));
}
