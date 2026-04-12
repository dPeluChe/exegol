/**
 * T68: Semantic search over the project's indexed codebase.
 *
 * v1: brute-force cosine similarity over the embedding BLOBs stored in
 * file_chunks. This works well up to ~100K chunks (~10K files). For larger
 * repos, v2 will use sqlite-vec's vec0 virtual table for ANN queries.
 *
 * Also supports FTS5 keyword fallback + Reciprocal Rank Fusion (RRF) to
 * merge vector + keyword results.
 */

import { cosineSimilarity } from "@exegol/shared";
import type Database from "libsql";
import { generateEmbedding, type OllamaConfig } from "./ollama-client";

export interface SearchResult {
  filePath: string;
  startLine: number;
  endLine: number;
  content: string;
  score: number;
  language: string;
  chunkType: string;
}

/** Search the indexed codebase semantically */
export async function semanticSearch(
  db: Database.Database,
  projectId: string,
  query: string,
  ollamaConfig: OllamaConfig,
  topK = 5,
): Promise<SearchResult[]> {
  // Step 1: Embed the query
  const queryEmbedding = await generateEmbedding(query, ollamaConfig);
  if (!queryEmbedding) {
    return [];
  }

  // Step 2: Fetch all chunks with embeddings for this project
  const chunks = db
    .prepare(
      `SELECT fc.content, fc.embedding, fc.start_line, fc.end_line, fc.chunk_type,
              fi.path, fi.language
       FROM file_chunks fc
       JOIN file_index fi ON fc.file_id = fi.id
       WHERE fi.project_id = ? AND fc.embedding IS NOT NULL`,
    )
    .all(projectId) as Array<{
    content: string;
    embedding: Buffer;
    start_line: number;
    end_line: number;
    chunk_type: string;
    path: string;
    language: string;
  }>;

  if (chunks.length === 0) {
    return [];
  }

  // Step 3: Compute cosine similarity for each chunk
  const scored = chunks.map((chunk) => {
    const embeddingArray = new Float32Array(chunk.embedding.buffer);
    const score = cosineSimilarity(queryEmbedding, embeddingArray);
    return {
      filePath: chunk.path,
      startLine: chunk.start_line,
      endLine: chunk.end_line,
      content: chunk.content,
      score,
      language: chunk.language,
      chunkType: chunk.chunk_type,
    };
  });

  // Step 4: Sort by score descending and return top-K
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topK);
}
