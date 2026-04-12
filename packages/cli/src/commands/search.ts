/**
 * Semantic search over the project's indexed codebase.
 * Stub for T68 — requires T100 (project indexing) to be functional.
 */

export function searchCommand(query: string): void {
  if (!query.trim()) {
    console.error("Usage: exegol search <query>");
    process.exit(1);
  }

  // T68 will fill this in once T100 (project indexing) lands:
  // 1. Resolve the current project from cwd (find nearest .git root → match to DB project)
  // 2. Embed the query via Ollama
  // 3. sqlite-vec cosine similarity search on file_chunks
  // 4. FTS5 keyword fallback
  // 5. RRF fusion of both result sets
  // 6. Print top-K results with file path, line range, and code snippet

  console.log(`\n  \x1b[33m⚠\x1b[0m  Project indexing not yet available (T100 + T68).\n`);
  console.log(`  When indexing is enabled, this command will search your project`);
  console.log(`  semantically using embeddings and return the most relevant code.`);
  console.log();
  console.log(`  Query: "${query}"`);
  console.log();
}
