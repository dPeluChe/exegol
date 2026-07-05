import { Button, cn } from "@exegol/ui";
import { BookOpen, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import { useProjectContext } from "../../../contexts/ProjectContext";
import {
  useImportMemoryBridgeAsSeed,
  useKnowledge,
  useRefreshDigest,
  useSaveBrief,
  useSyncMemoryBridge,
} from "../../../hooks/use-trpc-knowledge";
import { EmptyState } from "../../common/EmptyState";

export function KnowledgeSection() {
  const { projectId } = useProjectContext();
  const { data, isLoading } = useKnowledge(projectId);
  const saveBrief = useSaveBrief(projectId);
  const refreshDigest = useRefreshDigest(projectId);
  const syncMemoryBridge = useSyncMemoryBridge(projectId);
  const importSeed = useImportMemoryBridgeAsSeed(projectId);

  const [briefDraft, setBriefDraft] = useState("");
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (data && !dirty) setBriefDraft(data.brief);
  }, [data, dirty]);

  if (!projectId) {
    return (
      <div className="flex h-full items-center justify-center">
        <EmptyState
          icon={<BookOpen className="h-8 w-8 text-text-muted" />}
          title="No project selected"
          description="Select a project to view its knowledge base."
        />
      </div>
    );
  }

  if (isLoading || !data) {
    return (
      <div className="flex h-full items-center justify-center text-xs text-text-muted">
        Loading knowledge base…
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* Top bar */}
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border bg-bg-secondary px-3">
        <BookOpen className="h-4 w-4 text-text-muted" />
        <span className="text-xs font-medium text-text-primary">Knowledge</span>
        <span className="text-[10px] text-text-muted">.exegol/knowledge/</span>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-4">
        {/* PROJECT.md brief */}
        <section className="space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-semibold text-text-secondary">
              PROJECT.md — brief (committed)
            </h3>
            <Button
              type="button"
              disabled={!dirty || saveBrief.isPending}
              onClick={() =>
                saveBrief.mutate(briefDraft, {
                  onSuccess: () => setDirty(false),
                })
              }
              className="h-6 gap-1 bg-accent px-2 text-[10px] text-white"
            >
              Save
            </Button>
          </div>
          <textarea
            value={briefDraft}
            onChange={(e) => {
              setBriefDraft(e.target.value);
              setDirty(true);
            }}
            rows={12}
            className="w-full rounded-md border border-border bg-bg-tertiary px-3 py-2 font-mono text-[11px] text-text-primary focus:outline-none focus:ring-1 focus:ring-accent"
            style={{ resize: "vertical" }}
          />
        </section>

        {/* DIGEST.md */}
        <section className="space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-semibold text-text-secondary">
              DIGEST.md — auto-generated{" "}
              {data.digestStale && (
                <span className="ml-1 rounded bg-amber-500/20 px-1.5 py-0.5 text-[9px] text-amber-400">
                  stale
                </span>
              )}
            </h3>
            <Button
              type="button"
              disabled={refreshDigest.isPending}
              onClick={() => refreshDigest.mutate()}
              className={cn("h-6 gap-1 bg-bg-tertiary px-2 text-[10px] text-text-secondary")}
            >
              <RefreshCw className="h-3 w-3" />
              Force refresh
            </Button>
          </div>
          <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded-md border border-border bg-bg-tertiary px-3 py-2 font-mono text-[10px] text-text-secondary">
            {data.digest}
          </pre>
        </section>

        {/* MEMORY.md bridge */}
        <section className="space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-semibold text-text-secondary">
              MEMORY.md — bridge to Exegol memory (committed)
            </h3>
            <div className="flex gap-2">
              <Button
                type="button"
                disabled={syncMemoryBridge.isPending}
                onClick={() => syncMemoryBridge.mutate()}
                className="h-6 gap-1 bg-bg-tertiary px-2 text-[10px] text-text-secondary"
              >
                Sync MEMORY.md
              </Button>
              {data.memoryBridgeExists && (
                <Button
                  type="button"
                  disabled={importSeed.isPending}
                  onClick={() => importSeed.mutate()}
                  className="h-6 gap-1 bg-bg-tertiary px-2 text-[10px] text-text-secondary"
                >
                  Import as seed
                </Button>
              )}
            </div>
          </div>
          <p className="text-[10px] text-text-muted">
            Distills the top-salience facts from Exegol's memory store into a committed file so a
            fresh clone (or an agent outside Exegol) still sees the team's accumulated knowledge.
          </p>
        </section>
      </div>
    </div>
  );
}
