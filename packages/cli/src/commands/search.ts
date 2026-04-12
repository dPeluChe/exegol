/**
 * T68: Semantic search over the project's indexed codebase.
 *
 * Reads the indexed embeddings from the DB and computes cosine
 * similarity against the query embedding (generated via Ollama).
 * Requires T100 (project indexing) to have indexed the project first.
 */

import { getDb } from "../db";

const OLLAMA_URL = process.env.OLLAMA_URL ?? "http://localhost:11434";
const OLLAMA_MODEL = process.env.OLLAMA_MODEL ?? "nomic-embed-text";

export async function searchCommand(query: string): Promise<void> {
  if (!query.trim()) {
    console.error("Usage: exegol search <query>");
    process.exit(1);
  }

  const db = getDb();

  // Find the project from CWD (match .git root to project path in DB)
  const cwd = process.cwd();
  const project = db
    .prepare("SELECT id, name, path FROM projects WHERE path = ? OR path LIKE ?")
    .get(cwd, `${cwd}%`) as { id: string; name: string; path: string } | undefined;

  if (!project) {
    console.error(`No Exegol project found for: ${cwd}`);
    console.error("Open this folder in Exegol first, then try again.");
    process.exit(1);
  }

  // Check if project has been indexed
  const stats = db
    .prepare("SELECT COUNT(*) as count FROM file_chunks fc JOIN file_index fi ON fc.file_id = fi.id WHERE fi.project_id = ?")
    .get(project.id) as { count: number };

  if (stats.count === 0) {
    console.log(`\n  \x1b[33m⚠\x1b[0m  Project "${project.name}" has not been indexed yet.\n`);
    console.log("  Go to Exegol → Settings → Indexing → Start Indexing");
    console.log("  Or ensure Ollama is running with nomic-embed-text installed.\n");
    return;
  }

  // Generate query embedding via Ollama
  let queryEmbedding: number[];
  try {
    const res = await fetch(`${OLLAMA_URL}/api/embed`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: OLLAMA_MODEL, input: query }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      console.error(`Ollama error: ${res.status}. Is Ollama running?`);
      process.exit(1);
    }
    const data = (await res.json()) as { embeddings?: number[][] };
    if (!data.embeddings?.[0]) {
      console.error("Ollama returned no embeddings.");
      process.exit(1);
    }
    queryEmbedding = data.embeddings[0];
  } catch (err) {
    console.error(`Cannot connect to Ollama at ${OLLAMA_URL}: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }

  // Fetch all chunks and compute cosine similarity (brute force v1)
  const chunks = db
    .prepare(
      `SELECT fc.content, fc.embedding, fc.start_line, fc.end_line,
              fi.path, fi.language
       FROM file_chunks fc
       JOIN file_index fi ON fc.file_id = fi.id
       WHERE fi.project_id = ? AND fc.embedding IS NOT NULL`,
    )
    .all(project.id) as Array<{
    content: string;
    embedding: Buffer;
    start_line: number;
    end_line: number;
    path: string;
    language: string;
  }>;

  const scored = chunks.map((chunk) => {
    const emb = new Float32Array(chunk.embedding.buffer);
    let dot = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < queryEmbedding.length; i++) {
      const a = queryEmbedding[i] ?? 0;
      const b = emb[i] ?? 0;
      dot += a * b;
      normA += a * a;
      normB += b * b;
    }
    const denom = Math.sqrt(normA) * Math.sqrt(normB);
    const score = denom === 0 ? 0 : dot / denom;
    return { ...chunk, score };
  });

  scored.sort((a, b) => b.score - a.score);
  const topK = scored.slice(0, 5);

  if (topK.length === 0) {
    console.log("\n  No matching code found.\n");
    return;
  }

  console.log(`\n  \x1b[1mSearch results for:\x1b[0m "${query}" in ${project.name}\n`);

  for (const result of topK) {
    const scoreStr = (result.score * 100).toFixed(1);
    console.log(
      `  \x1b[36m${result.path}\x1b[0m:${result.start_line}-${result.end_line}  \x1b[90m(${scoreStr}% match, ${result.language})\x1b[0m`,
    );
    // Show first 3 lines of content as preview
    const preview = result.content.split("\n").slice(0, 3).join("\n    ");
    console.log(`    ${preview}`);
    console.log();
  }
}
