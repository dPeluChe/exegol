import type { ImportCandidate } from "@exegol/shared";
import { Badge, Button, cn } from "@exegol/ui";
import { AlertTriangle, FolderInput, Loader2, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useImportSkills, useScanImports } from "../../../hooks/use-trpc-skills";

export function SkillImportDialog({ onClose }: { onClose: () => void }) {
  const { data: candidates, refetch, isFetching } = useScanImports();
  const importMutation = useImportSkills();
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // Trigger scan on mount + Escape to close
  useEffect(() => {
    refetch();
  }, [refetch]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  const toggleSkill = useCallback((key: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const toggleAgent = useCallback(
    (candidate: ImportCandidate) => {
      const importable = candidate.skills.filter((s) => !s.isSymlink && !s.alreadyExists);
      const keys = importable.map((s) => `${candidate.agent}:${s.name}`);
      const allSelected = keys.every((k) => selected.has(k));

      setSelected((prev) => {
        const next = new Set(prev);
        for (const k of keys) {
          if (allSelected) next.delete(k);
          else next.add(k);
        }
        return next;
      });
    },
    [selected],
  );

  const handleImport = useCallback(() => {
    if (!candidates) return;

    const skills: Array<{ agent: string; sourcePath: string; name: string }> = [];
    for (const c of candidates) {
      for (const s of c.skills) {
        if (selected.has(`${c.agent}:${s.name}`)) {
          skills.push({ agent: c.agent, sourcePath: s.sourcePath, name: s.name });
        }
      }
    }

    if (skills.length > 0) {
      importMutation.mutate({ skills });
    }
  }, [candidates, selected, importMutation]);

  const hasImportable = candidates?.some((c) =>
    c.skills.some((s) => !s.isSymlink && !s.alreadyExists),
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="w-[520px] max-h-[80vh] flex flex-col rounded-xl border border-border bg-bg-primary shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <div className="flex items-center gap-2">
            <FolderInput className="h-4 w-4 text-accent" />
            <span className="text-sm font-medium text-text-primary">Import Local Skills</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-text-muted hover:text-text-primary"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-4">
          {isFetching ? (
            <div className="flex items-center justify-center py-12 gap-2 text-text-muted">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span className="text-xs">Scanning agent directories...</span>
            </div>
          ) : !candidates || candidates.length === 0 ? (
            <p className="text-xs text-text-muted text-center py-12">
              No importable skills found in agent directories. Skills that are already symlinked or
              part of ~/.agents/skills/ are excluded.
            </p>
          ) : (
            <div className="space-y-4">
              {candidates.map((candidate) => (
                <AgentGroup
                  key={candidate.agent}
                  candidate={candidate}
                  selected={selected}
                  onToggleSkill={toggleSkill}
                  onToggleAgent={toggleAgent}
                />
              ))}
            </div>
          )}

          {importMutation.isSuccess && importMutation.data && (
            <div className="mt-4 rounded-lg border border-green-500/30 bg-green-500/10 p-3">
              {importMutation.data.installed.length > 0 && (
                <p className="text-[11px] text-green-400">
                  Imported: {importMutation.data.installed.join(", ")}
                </p>
              )}
              {importMutation.data.skipped.length > 0 && (
                <p className="text-[11px] text-yellow-400 mt-1">
                  Skipped: {importMutation.data.skipped.join(", ")}
                </p>
              )}
              {importMutation.data.errors.length > 0 && (
                <p className="text-[11px] text-red-400 mt-1">
                  Errors: {importMutation.data.errors.join(", ")}
                </p>
              )}
              <Button
                size="sm"
                variant="outline"
                onClick={onClose}
                className="mt-2 text-[10px] h-6"
              >
                Done
              </Button>
            </div>
          )}
        </div>

        {/* Footer */}
        {hasImportable && !importMutation.isSuccess && (
          <div className="flex items-center justify-between border-t border-border px-4 py-3">
            <span className="text-[10px] text-text-muted">
              {selected.size} skill{selected.size !== 1 ? "s" : ""} selected
            </span>
            <Button
              size="sm"
              onClick={handleImport}
              disabled={selected.size === 0 || importMutation.isPending}
              className="text-xs h-7"
            >
              {importMutation.isPending ? (
                <>
                  <Loader2 className="h-3 w-3 animate-spin mr-1" /> Importing...
                </>
              ) : (
                <>
                  <FolderInput className="h-3 w-3 mr-1" /> Import to ~/.agents/skills/
                </>
              )}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Agent group ────────────────────────────────────────────────────────────

function AgentGroup({
  candidate,
  selected,
  onToggleSkill,
  onToggleAgent,
}: {
  candidate: ImportCandidate;
  selected: Set<string>;
  onToggleSkill: (key: string) => void;
  onToggleAgent: (candidate: ImportCandidate) => void;
}) {
  const importable = candidate.skills.filter((s) => !s.isSymlink);
  const allSelected = importable
    .filter((s) => !s.alreadyExists)
    .every((s) => selected.has(`${candidate.agent}:${s.name}`));

  return (
    <div className="rounded-lg border border-border bg-bg-secondary">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border/50">
        <input
          type="checkbox"
          checked={allSelected && importable.length > 0}
          onChange={() => onToggleAgent(candidate)}
          className="accent-accent h-3.5 w-3.5"
        />
        <span className="text-xs font-medium text-text-primary capitalize">{candidate.agent}</span>
        <Badge className="text-[9px] bg-bg-tertiary text-text-muted ml-auto">
          {candidate.skills.length} skill{candidate.skills.length !== 1 ? "s" : ""}
        </Badge>
      </div>

      <div className="p-2 space-y-1">
        {candidate.skills.map((skill) => {
          const key = `${candidate.agent}:${skill.name}`;
          const disabled = skill.isSymlink || skill.alreadyExists;

          return (
            <label
              key={key}
              className={cn(
                "flex items-center gap-2 rounded px-2 py-1 text-[11px]",
                disabled ? "opacity-50" : "hover:bg-bg-tertiary cursor-pointer",
              )}
            >
              <input
                type="checkbox"
                checked={selected.has(key)}
                onChange={() => onToggleSkill(key)}
                disabled={disabled}
                className="accent-accent h-3 w-3"
              />
              <span className="text-text-secondary">{skill.name}</span>
              {skill.alreadyExists && (
                <span className="flex items-center gap-0.5 text-[9px] text-yellow-400 ml-auto">
                  <AlertTriangle className="h-2.5 w-2.5" /> exists
                </span>
              )}
              {skill.isSymlink && (
                <span className="text-[9px] text-text-muted ml-auto">symlink</span>
              )}
            </label>
          );
        })}
      </div>
    </div>
  );
}
