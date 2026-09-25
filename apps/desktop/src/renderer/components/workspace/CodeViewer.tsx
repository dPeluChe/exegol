import { cn } from "@exegol/ui";
import Editor, { loader } from "@monaco-editor/react";
import { Code2, Eye, ListTree } from "lucide-react";
import * as monaco from "monaco-editor";
import { useState } from "react";
import { Streamdown } from "streamdown";
import { JsonTree } from "./JsonTree";

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
      <Streamdown>{content}</Streamdown>
    </div>
  );
}

// ─── Main CodeViewer ───────────────────────────────────────────────────────

interface CodeViewerProps {
  content: string;
  fileName: string | null;
}

const JSON_EXT = /\.(json|jsonc|geojson|webmanifest)$/i;
const JSONL_EXT = /\.(jsonl|ndjson)$/i;

function ModeButton({
  active,
  onClick,
  icon: Icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: typeof Code2;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex items-center gap-1 rounded px-2 py-0.5 text-[10px] font-medium transition-colors",
        active ? "bg-white/10 text-text-primary" : "text-text-muted hover:text-text-secondary",
      )}
    >
      <Icon className="h-3 w-3" />
      {label}
    </button>
  );
}

export function CodeViewer({ content, fileName }: CodeViewerProps) {
  const language = fileName ? getMonacoLanguage(fileName) : "plaintext";
  // Files with a rendered view: markdown (Preview) and JSON/JSONL (Tree, shown first)
  const rendered = !fileName
    ? null
    : isMarkdown(fileName)
      ? ({ label: "Preview", icon: Eye, first: false } as const)
      : JSON_EXT.test(fileName) || JSONL_EXT.test(fileName)
        ? ({ label: "Tree", icon: ListTree, first: true } as const)
        : null;
  // Past 1MB the tree starts behind the Code tab: parsing is paid only on request
  const [showRendered, setShowRendered] = useState(
    (rendered?.first ?? false) && content.length < 1_000_000,
  );

  if (!fileName || !rendered) {
    return <MonacoViewer content={content} language={language} />;
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-7 shrink-0 items-center gap-1 border-b border-border bg-bg-tertiary px-2">
        <ModeButton
          active={!showRendered}
          onClick={() => setShowRendered(false)}
          icon={Code2}
          label="Code"
        />
        <ModeButton
          active={showRendered}
          onClick={() => setShowRendered(true)}
          icon={rendered.icon}
          label={rendered.label}
        />
      </div>
      <div className="min-h-0 flex-1">
        {!showRendered ? (
          <MonacoViewer content={content} language={language} />
        ) : rendered.label === "Preview" ? (
          <MarkdownViewer content={content} />
        ) : (
          <JsonTree content={content} lines={JSONL_EXT.test(fileName)} />
        )}
      </div>
    </div>
  );
}
