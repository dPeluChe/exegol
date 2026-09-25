import { cn } from "@exegol/ui";
import { useQuery } from "@tanstack/react-query";
import { FileText, Search, TextSearch, X } from "lucide-react";
import { useEffect, useState } from "react";
import { trpcInvoke } from "../../lib/trpc-client";

interface NameHit {
  path: string;
  relativePath: string;
}
interface TextHit {
  path: string;
  relativePath: string;
  lineNumber: number;
  line: string;
}
interface SearchResponse {
  mode: "name" | "text";
  names: NameHit[];
  hits: TextHit[];
}

/**
 * Search box over the explorer: file names (fuzzy) or text in files, across
 * the project root and its subrepos. While a query is typed the results
 * replace the tree; Esc or the X brings the tree back.
 */
export function FileSearch({
  projectId,
  rootPath,
  onPick,
  children,
}: {
  projectId: string;
  rootPath: string;
  onPick: (path: string, line?: number) => void;
  /** The tree, shown when there is no query */
  children: React.ReactNode;
}) {
  const [input, setInput] = useState("");
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<"name" | "text">("name");

  useEffect(() => {
    const t = setTimeout(() => setQuery(input.trim()), 250);
    return () => clearTimeout(t);
  }, [input]);

  const active = query.length >= 2;
  const { data, isFetching, error } = useQuery({
    queryKey: ["fsSearch", projectId, rootPath, mode, query],
    queryFn: () =>
      trpcInvoke<SearchResponse>("fsSearch.projectSearch", {
        projectId,
        root: rootPath,
        query,
        mode,
      }),
    enabled: active,
    staleTime: 10_000,
  });

  const clear = () => {
    setInput("");
    setQuery("");
  };

  return (
    <>
      <div className="flex shrink-0 items-center gap-1 border-b border-border px-2 py-1">
        <Search className="h-3 w-3 shrink-0 text-text-muted" />
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") clear();
          }}
          placeholder={mode === "name" ? "Find a file..." : "Search text in files..."}
          className="min-w-0 flex-1 bg-transparent text-[11px] text-text-primary outline-none placeholder:text-text-muted"
        />
        {input && (
          <button
            type="button"
            onClick={clear}
            className="text-text-muted hover:text-text-primary"
            title="Clear (Esc)"
          >
            <X className="h-3 w-3" />
          </button>
        )}
        {(
          [
            ["name", FileText, "Search file names"],
            ["text", TextSearch, "Search text in files"],
          ] as const
        ).map(([m, Icon, title]) => (
          <button
            key={m}
            type="button"
            onClick={() => setMode(m)}
            className={cn(
              "rounded p-0.5",
              mode === m
                ? "bg-white/10 text-text-primary"
                : "text-text-muted hover:text-text-secondary",
            )}
            title={title}
          >
            <Icon className="h-3 w-3" />
          </button>
        ))}
      </div>

      {active ? (
        <div className="min-h-0 flex-1 overflow-auto py-1 text-[11px]">
          <SearchResults
            data={data}
            error={error}
            isFetching={isFetching}
            query={query}
            onPick={onPick}
          />
        </div>
      ) : (
        children
      )}
    </>
  );
}

function SearchResults({
  data,
  error,
  isFetching,
  query,
  onPick,
}: {
  data: SearchResponse | undefined;
  error: unknown;
  isFetching: boolean;
  query: string;
  onPick: (path: string, line?: number) => void;
}) {
  const note = (text: string, className = "text-text-muted") => (
    <p className={cn("px-3 py-2", className)}>{text}</p>
  );
  if (error) return note(error instanceof Error ? error.message : String(error), "text-red-400");
  if (!data) return note(isFetching ? "Searching..." : "");
  if (data.mode === "name") {
    if (data.names.length === 0) return note(`No file matches "${query}".`);
    return data.names.map((n) => (
      <button
        key={n.path}
        type="button"
        onClick={() => onPick(n.path)}
        className="flex w-full items-baseline gap-1.5 px-3 py-0.5 text-left hover:bg-white/5"
        title={n.relativePath}
      >
        <span className="shrink-0 text-text-primary">{n.relativePath.split("/").pop()}</span>
        <span className="truncate text-[10px] text-text-muted">{n.relativePath}</span>
      </button>
    ));
  }
  if (data.hits.length === 0) return note(`No text matches "${query}".`);
  return data.hits.map((h) => (
    <button
      key={`${h.path}:${h.lineNumber}`}
      type="button"
      onClick={() => onPick(h.path, h.lineNumber)}
      className="flex w-full flex-col px-3 py-0.5 text-left hover:bg-white/5"
      title={`${h.relativePath}:${h.lineNumber}`}
    >
      <span className="truncate text-[10px] text-text-muted">
        {h.relativePath}:{h.lineNumber}
      </span>
      <span className="truncate font-mono text-text-secondary">{h.line.trim()}</span>
    </button>
  ));
}
