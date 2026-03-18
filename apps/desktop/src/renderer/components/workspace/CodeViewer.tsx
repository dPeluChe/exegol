import { cn } from "@exegol/ui";
import Editor, { loader } from "@monaco-editor/react";
import { Code2, Eye } from "lucide-react";
import * as monaco from "monaco-editor";
import { useState } from "react";
import Markdown from "react-markdown";

// Use local monaco-editor instance instead of CDN
loader.config({ monaco });

// ─── Language Detection ─────────────────────────────────────────────────────

const EXT_TO_MONACO_LANG: Record<string, string> = {
  ".ts": "typescript",
  ".tsx": "typescript",
  ".js": "javascript",
  ".jsx": "javascript",
  ".mjs": "javascript",
  ".cjs": "javascript",
  ".rs": "rust",
  ".py": "python",
  ".go": "go",
  ".css": "css",
  ".scss": "scss",
  ".less": "less",
  ".html": "html",
  ".htm": "html",
  ".json": "json",
  ".jsonc": "jsonc",
  ".toml": "ini",
  ".yaml": "yaml",
  ".yml": "yaml",
  ".sh": "shell",
  ".bash": "shell",
  ".zsh": "shell",
  ".c": "c",
  ".cpp": "cpp",
  ".h": "c",
  ".hpp": "cpp",
  ".java": "java",
  ".kt": "kotlin",
  ".swift": "swift",
  ".rb": "ruby",
  ".lua": "lua",
  ".sql": "sql",
  ".graphql": "graphql",
  ".gql": "graphql",
  ".xml": "xml",
  ".svg": "xml",
  ".md": "markdown",
  ".mdx": "markdown",
  ".dockerfile": "dockerfile",
  ".env": "shell",
  ".gitignore": "plaintext",
  ".vue": "html",
  ".svelte": "html",
};

function getMonacoLanguage(fileName: string): string {
  const ext = fileName.slice(fileName.lastIndexOf(".")).toLowerCase();
  const base = fileName.split("/").pop()?.toLowerCase() ?? "";
  if (base === "dockerfile") return "dockerfile";
  if (base === ".env" || base.startsWith(".env.")) return "shell";
  return EXT_TO_MONACO_LANG[ext] ?? "plaintext";
}

function isMarkdown(fileName: string): boolean {
  const ext = fileName.slice(fileName.lastIndexOf(".")).toLowerCase();
  return ext === ".md" || ext === ".mdx";
}

// ─── Monaco Code Viewer ────────────────────────────────────────────────────

function MonacoViewer({ content, language }: { content: string; language: string }) {
  return (
    <Editor
      height="100%"
      language={language}
      value={content}
      theme="vs-dark"
      loading={
        <div className="flex h-full items-center justify-center text-xs text-text-muted">
          Loading editor...
        </div>
      }
      options={{
        readOnly: true,
        minimap: { enabled: false },
        scrollBeyondLastLine: false,
        fontSize: 12,
        lineNumbers: "on",
        renderLineHighlight: "none",
        overviewRulerLanes: 0,
        hideCursorInOverviewRuler: true,
        scrollbar: {
          vertical: "auto",
          horizontal: "auto",
        },
        domReadOnly: true,
        contextmenu: false,
        folding: true,
        wordWrap: "off",
        padding: { top: 8 },
      }}
    />
  );
}

// ─── Markdown Renderer ─────────────────────────────────────────────────────

function MarkdownViewer({ content }: { content: string }) {
  return (
    <div className="prose prose-invert prose-sm max-w-none overflow-auto p-4 text-text-primary prose-headings:text-text-primary prose-a:text-accent prose-strong:text-text-primary prose-code:rounded prose-code:bg-bg-tertiary prose-code:px-1 prose-code:py-0.5 prose-code:text-[12px] prose-code:text-accent prose-pre:bg-bg-tertiary prose-pre:text-[12px]">
      <Markdown>{content}</Markdown>
    </div>
  );
}

// ─── Main CodeViewer ───────────────────────────────────────────────────────

interface CodeViewerProps {
  content: string;
  fileName: string | null;
}

export function CodeViewer({ content, fileName }: CodeViewerProps) {
  const isMd = fileName ? isMarkdown(fileName) : false;
  const [mdMode, setMdMode] = useState<"code" | "render">("code");
  const language = fileName ? getMonacoLanguage(fileName) : "plaintext";

  if (!fileName) {
    return <MonacoViewer content={content} language="plaintext" />;
  }

  if (isMd) {
    return (
      <div className="flex h-full flex-col">
        <div className="flex h-7 shrink-0 items-center gap-1 border-b border-border bg-bg-tertiary px-2">
          <button
            type="button"
            onClick={() => setMdMode("code")}
            className={cn(
              "flex items-center gap-1 rounded px-2 py-0.5 text-[10px] font-medium transition-colors",
              mdMode === "code"
                ? "bg-white/10 text-text-primary"
                : "text-text-muted hover:text-text-secondary",
            )}
          >
            <Code2 className="h-3 w-3" />
            Code
          </button>
          <button
            type="button"
            onClick={() => setMdMode("render")}
            className={cn(
              "flex items-center gap-1 rounded px-2 py-0.5 text-[10px] font-medium transition-colors",
              mdMode === "render"
                ? "bg-white/10 text-text-primary"
                : "text-text-muted hover:text-text-secondary",
            )}
          >
            <Eye className="h-3 w-3" />
            Preview
          </button>
        </div>
        <div className="flex-1">
          {mdMode === "render" ? (
            <MarkdownViewer content={content} />
          ) : (
            <MonacoViewer content={content} language="markdown" />
          )}
        </div>
      </div>
    );
  }

  return <MonacoViewer content={content} language={language} />;
}
