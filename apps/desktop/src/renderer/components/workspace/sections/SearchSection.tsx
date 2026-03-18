import type { SearchResult } from "@exegol/shared";
import { Button, cn, Input, ScrollArea } from "@exegol/ui";
import { FileText, MessageSquare, RefreshCw, Search, Terminal, Timer } from "lucide-react";
import { type ReactNode, useCallback, useRef, useState } from "react";
import { useProjectContext } from "../../../contexts/ProjectContext";
import { useRebuildSearchIndex, useSearch } from "../../../hooks/use-trpc";
import { EmptyState, LoadingSpinner } from "../../common";

/** Render FTS5 snippet with <mark> tags as safe React elements. */
function renderSnippet(html: string): ReactNode[] {
  const parts: ReactNode[] = [];
  let remaining = html;
  let key = 0;

  while (remaining.length > 0) {
    const markStart = remaining.indexOf("<mark>");
    if (markStart === -1) {
      parts.push(remaining);
      break;
    }
    if (markStart > 0) {
      parts.push(remaining.slice(0, markStart));
    }
    const markEnd = remaining.indexOf("</mark>", markStart);
    if (markEnd === -1) {
      parts.push(remaining.slice(markStart));
      break;
    }
    const highlighted = remaining.slice(markStart + 6, markEnd);
    parts.push(
      <mark key={key++} className="rounded bg-yellow-500/20 px-0.5 text-yellow-300">
        {highlighted}
      </mark>,
    );
    remaining = remaining.slice(markEnd + 7);
  }

  return parts;
}

// ─── Entity type icon + label mapping ────────────────────────────────────

const ENTITY_CONFIG: Record<
  SearchResult["entityType"],
  { icon: typeof Search; label: string; color: string }
> = {
  scrollback: { icon: Terminal, label: "Agent Output", color: "text-green-400" },
  prompt: { icon: FileText, label: "Prompt", color: "text-blue-400" },
  task_description: { icon: MessageSquare, label: "Task", color: "text-purple-400" },
  scheduler_result: { icon: Timer, label: "Scheduler", color: "text-yellow-400" },
};

// ─── Result card ─────────────────────────────────────────────────────────

function SearchResultCard({ result }: { result: SearchResult }) {
  const config = ENTITY_CONFIG[result.entityType];
  const Icon = config.icon;

  return (
    <div className="rounded-lg border border-border bg-bg-secondary p-3 transition-colors hover:border-accent/30">
      <div className="mb-1.5 flex items-center gap-2">
        <Icon className={cn("h-3.5 w-3.5 shrink-0", config.color)} />
        <span className="text-[10px] font-medium text-text-muted">{config.label}</span>
        <span className="ml-auto text-[9px] text-text-muted">score: {result.score.toFixed(2)}</span>
      </div>
      <h3 className="mb-1 truncate text-xs font-medium text-text-primary">{result.title}</h3>
      <p className="line-clamp-3 text-[11px] leading-relaxed text-text-secondary">
        {renderSnippet(result.snippet)}
      </p>
    </div>
  );
}

// ─── Main Section ────────────────────────────────────────────────────────

export function SearchSection() {
  const { projectId } = useProjectContext();
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { data: results, isLoading } = useSearch(debouncedQuery, projectId);
  const rebuildIndex = useRebuildSearchIndex();

  const handleQueryChange = useCallback((value: string) => {
    setQuery(value);
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    debounceTimerRef.current = setTimeout(() => {
      setDebouncedQuery(value.trim());
    }, 300);
  }, []);

  return (
    <div className="flex h-full flex-col">
      {/* Search header */}
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-3">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-muted" />
          <Input
            type="text"
            value={query}
            onChange={(e) => handleQueryChange(e.target.value)}
            placeholder='Search agents, prompts, tasks... (use "quotes" for exact phrases)'
            className="pl-8 text-xs"
          />
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="h-8 gap-1.5 px-2.5 text-[11px]"
          onClick={() => rebuildIndex.mutate()}
          disabled={rebuildIndex.isPending}
          title="Rebuild search index from current DB state"
        >
          <RefreshCw className={cn("h-3.5 w-3.5", rebuildIndex.isPending && "animate-spin")} />
          Rebuild Index
        </Button>
      </div>

      {/* Results */}
      <ScrollArea className="flex-1">
        <div className="p-4">
          {!debouncedQuery && (
            <EmptyState
              icon={<Search className="h-10 w-10 text-text-muted/30" />}
              title="Search your project"
              description='Search across agent transcripts, prompts, and task descriptions. Use "quotes" for exact phrases.'
              className="h-full"
            />
          )}

          {debouncedQuery && isLoading && <LoadingSpinner label="Searching..." className="py-8" />}

          {debouncedQuery && !isLoading && results && results.length === 0 && (
            <EmptyState
              icon={<Search className="h-6 w-6 text-text-muted/40" />}
              title="No results"
              description={`No results found for "${debouncedQuery}"`}
            />
          )}

          {results && results.length > 0 && (
            <div className="space-y-2">
              <p className="mb-3 text-[10px] font-medium text-text-muted">
                {results.length} result{results.length === 1 ? "" : "s"}
              </p>
              {results.map((result) => (
                <SearchResultCard key={result.entityId} result={result} />
              ))}
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
