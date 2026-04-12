/**
 * T100: Background project indexer.
 *
 * Scans a project's files, chunks them, generates embeddings via Ollama,
 * and stores everything in the file_index + file_chunks tables. Supports
 * incremental indexing: only re-indexes files whose SHA-256 hash changed.
 *
 * This is v1 (line-based chunking). v2 will use Tree-sitter AST-aware
 * chunking via core-rust for significantly better retrieval quality.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import type Database from "libsql";
import { nanoid } from "nanoid";
import { logger } from "../lib/logger";
import { chunkFileContent, computeFileHash, detectLanguage, shouldExclude } from "./chunker";
import { generateEmbedding, type OllamaConfig } from "./ollama-client";

const MAX_FILE_SIZE = 1024 * 1024; // 1MB — skip very large files

export interface IndexingProgress {
  projectId: string;
  totalFiles: number;
  indexedFiles: number;
  skippedFiles: number;
  status: "idle" | "scanning" | "indexing" | "done" | "error";
  error?: string;
}

type ProgressCallback = (progress: IndexingProgress) => void;

/** Walk a directory recursively, yielding relative file paths */
function walkDir(rootPath: string, excludePatterns: string[]): string[] {
  const files: string[] = [];

  function walk(dir: string): void {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return; // permission denied or similar
    }
    for (const entry of entries) {
      const fullPath = join(dir, entry);
      const relPath = relative(rootPath, fullPath);

      if (shouldExclude(relPath, excludePatterns)) continue;

      try {
        const stat = statSync(fullPath);
        if (stat.isDirectory()) {
          walk(fullPath);
        } else if (stat.isFile() && stat.size <= MAX_FILE_SIZE) {
          files.push(relPath);
        }
      } catch {
        // skip unreadable files
      }
    }
  }

  walk(rootPath);
  return files;
}

/**
 * Index a project. Scans files, compares hashes, chunks changed files,
 * generates embeddings, and stores in DB. Safe to call repeatedly — only
 * re-indexes files that changed since the last run.
 */
export async function indexProject(
  db: Database.Database,
  projectId: string,
  projectPath: string,
  ollamaConfig: OllamaConfig,
  excludePatterns: string[],
  onProgress?: ProgressCallback,
): Promise<IndexingProgress> {
  const progress: IndexingProgress = {
    projectId,
    totalFiles: 0,
    indexedFiles: 0,
    skippedFiles: 0,
    status: "scanning",
  };

  try {
    onProgress?.(progress);

    // Step 1: Scan project files
    const files = walkDir(projectPath, excludePatterns);
    progress.totalFiles = files.length;
    logger.info(`[Indexer] Scanning ${projectPath}: ${files.length} files`);

    progress.status = "indexing";
    onProgress?.(progress);

    // Prepare DB statements
    const getFileStmt = db.prepare(
      "SELECT id, hash FROM file_index WHERE project_id = ? AND path = ?",
    );
    const upsertFileStmt = db.prepare(
      `INSERT INTO file_index (id, project_id, path, hash, language, chunk_count, indexed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(project_id, path) DO UPDATE SET
         hash = excluded.hash, language = excluded.language,
         chunk_count = excluded.chunk_count, indexed_at = excluded.indexed_at`,
    );
    const deleteChunksStmt = db.prepare("DELETE FROM file_chunks WHERE file_id = ?");
    const insertChunkStmt = db.prepare(
      `INSERT INTO file_chunks (id, file_id, content, embedding, start_line, end_line, chunk_type)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );

    // Step 2: Index changed files
    for (const filePath of files) {
      const fullPath = join(projectPath, filePath);
      let content: string;
      try {
        content = readFileSync(fullPath, "utf-8");
      } catch {
        progress.skippedFiles++;
        continue;
      }

      const hash = computeFileHash(content);

      // Check if file already indexed with same hash
      const existing = getFileStmt.get(projectId, filePath) as
        | { id: string; hash: string }
        | undefined;
      if (existing?.hash === hash) {
        progress.skippedFiles++;
        continue; // Unchanged — skip
      }

      // File changed or new — chunk and embed
      const chunks = chunkFileContent(content);
      const language = detectLanguage(filePath);
      const fileId = existing?.id ?? nanoid();
      const now = Math.floor(Date.now() / 1000);

      // Delete old chunks if re-indexing
      if (existing) {
        deleteChunksStmt.run(existing.id);
      }

      // Upsert file record
      upsertFileStmt.run(fileId, projectId, filePath, hash, language, chunks.length, now);

      // Generate embeddings + insert chunks
      for (const chunk of chunks) {
        const embedding = await generateEmbedding(chunk.content, ollamaConfig);
        const embeddingBlob = embedding ? Buffer.from(new Float32Array(embedding).buffer) : null;
        insertChunkStmt.run(
          nanoid(),
          fileId,
          chunk.content,
          embeddingBlob,
          chunk.startLine,
          chunk.endLine,
          chunk.chunkType,
        );
      }

      progress.indexedFiles++;
      // Report progress every 10 files
      if (progress.indexedFiles % 10 === 0) {
        onProgress?.(progress);
        logger.info(
          `[Indexer] Progress: ${progress.indexedFiles}/${progress.totalFiles} (${progress.skippedFiles} skipped)`,
        );
      }
    }

    // Step 3: Remove files from index that no longer exist on disk
    const indexedFiles = db
      .prepare("SELECT id, path FROM file_index WHERE project_id = ?")
      .all(projectId) as Array<{ id: string; path: string }>;

    const diskFiles = new Set(files);
    for (const indexed of indexedFiles) {
      if (!diskFiles.has(indexed.path)) {
        deleteChunksStmt.run(indexed.id);
        db.prepare("DELETE FROM file_index WHERE id = ?").run(indexed.id);
        logger.info(`[Indexer] Removed deleted file from index: ${indexed.path}`);
      }
    }

    progress.status = "done";
    onProgress?.(progress);
    logger.info(
      `[Indexer] Done: ${progress.indexedFiles} indexed, ${progress.skippedFiles} unchanged, ${progress.totalFiles} total`,
    );

    return progress;
  } catch (err) {
    progress.status = "error";
    progress.error = err instanceof Error ? err.message : String(err);
    onProgress?.(progress);
    logger.error(`[Indexer] Failed:`, err);
    return progress;
  }
}
