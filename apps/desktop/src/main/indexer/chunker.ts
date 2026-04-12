/**
 * T100: Code chunking for project indexing.
 *
 * v1: line-based chunking with overlap (500 lines, 50 overlap).
 * v2 (future): Tree-sitter AST-aware chunking in core-rust for 70% Recall@5
 *              (vs 42% for line-based). See supermemory/code-chunk for reference.
 */

import { createHash } from "node:crypto";

const CHUNK_SIZE = 500;
const CHUNK_OVERLAP = 50;

export interface CodeChunk {
  content: string;
  startLine: number;
  endLine: number;
  chunkType: "block" | "function" | "class" | "fallback";
}

/** Split file content into overlapping chunks */
export function chunkFileContent(content: string): CodeChunk[] {
  const lines = content.split("\n");
  if (lines.length <= CHUNK_SIZE) {
    return [
      {
        content,
        startLine: 1,
        endLine: lines.length,
        chunkType: "block",
      },
    ];
  }

  const chunks: CodeChunk[] = [];
  let start = 0;

  while (start < lines.length) {
    const end = Math.min(start + CHUNK_SIZE, lines.length);
    const chunkLines = lines.slice(start, end);
    chunks.push({
      content: chunkLines.join("\n"),
      startLine: start + 1,
      endLine: end,
      chunkType: "block",
    });
    start += CHUNK_SIZE - CHUNK_OVERLAP;
    if (start >= lines.length) break;
  }

  return chunks;
}

/** Compute SHA-256 hash of file content for change detection */
export function computeFileHash(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

/** Detect language from file extension */
export function detectLanguage(filePath: string): string {
  const ext = filePath.split(".").pop()?.toLowerCase() ?? "";
  const langMap: Record<string, string> = {
    ts: "TypeScript",
    tsx: "TypeScript",
    js: "JavaScript",
    jsx: "JavaScript",
    py: "Python",
    rb: "Ruby",
    go: "Go",
    rs: "Rust",
    java: "Java",
    kt: "Kotlin",
    c: "C",
    cpp: "C++",
    cs: "C#",
    php: "PHP",
    swift: "Swift",
    scala: "Scala",
    html: "HTML",
    css: "CSS",
    scss: "SCSS",
    json: "JSON",
    yaml: "YAML",
    yml: "YAML",
    md: "Markdown",
    sql: "SQL",
    sh: "Shell",
    bash: "Shell",
    zsh: "Shell",
    toml: "TOML",
    xml: "XML",
    vue: "Vue",
    svelte: "Svelte",
  };
  return langMap[ext] ?? "Unknown";
}

/** Default patterns to exclude from indexing */
export const DEFAULT_EXCLUDE_PATTERNS = [
  "node_modules",
  "dist",
  "build",
  "out",
  ".git",
  ".next",
  ".nuxt",
  ".svelte-kit",
  "target", // Rust
  "__pycache__",
  ".venv",
  "venv",
  "*.lock",
  "*.lockb",
  "package-lock.json",
  "bun.lock",
  "yarn.lock",
  "pnpm-lock.yaml",
  "*.min.js",
  "*.min.css",
  "*.map",
  "*.wasm",
  "*.ttf",
  "*.woff",
  "*.woff2",
  "*.otf",
  "*.png",
  "*.jpg",
  "*.jpeg",
  "*.gif",
  "*.ico",
  "*.svg",
  "*.mp4",
  "*.mp3",
  "*.pdf",
  "*.zip",
  "*.tar",
  "*.gz",
  "*.dmg",
  "*.exe",
  "*.dll",
  "*.so",
  "*.dylib",
  "*.node",
];

/** Check if a file path matches any exclude pattern */
export function shouldExclude(
  filePath: string,
  patterns: string[] = DEFAULT_EXCLUDE_PATTERNS,
): boolean {
  for (const pattern of patterns) {
    if (pattern.startsWith("*.")) {
      // Extension match
      if (filePath.endsWith(pattern.slice(1))) return true;
    } else {
      // Directory or exact file match
      if (
        filePath.includes(`/${pattern}/`) ||
        filePath.includes(`/${pattern}`) ||
        filePath === pattern
      ) {
        return true;
      }
    }
  }
  return false;
}
