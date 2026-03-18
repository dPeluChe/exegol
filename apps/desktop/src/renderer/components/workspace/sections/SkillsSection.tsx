import type { SkillCategory, SkillWithState } from "@exegol/shared";
import { SKILL_CATEGORIES } from "@exegol/shared";
import { Badge, cn, ScrollArea } from "@exegol/ui";
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  FolderOpen,
  Globe,
  Shield,
  Wand2,
} from "lucide-react";
import { useCallback, useState } from "react";
import { useProjectContext } from "../../../contexts/ProjectContext";
import { useProject } from "../../../hooks/use-trpc";
import { useSkills, useToggleSkill } from "../../../hooks/use-trpc-skills";
import { EmptyState } from "../../common/EmptyState";

// ─── Category styling ────────────────────────────────────────────────────────

const CATEGORY_COLORS: Record<SkillCategory, string> = {
  architect: "bg-purple-500/20 text-purple-400",
  qa: "bg-green-500/20 text-green-400",
  debugger: "bg-red-500/20 text-red-400",
  reviewer: "bg-blue-500/20 text-blue-400",
  documenter: "bg-amber-500/20 text-amber-400",
  custom: "bg-zinc-500/20 text-zinc-400",
};

const CATEGORY_LABELS: Record<SkillCategory, string> = {
  architect: "Architect",
  qa: "QA",
  debugger: "Debugger",
  reviewer: "Reviewer",
  documenter: "Documenter",
  custom: "Custom",
};

// ─── Main component ──────────────────────────────────────────────────────────

export function SkillsSection() {
  const { projectId } = useProjectContext();
  const { data: project } = useProject(projectId);
  const { data: skills } = useSkills(projectId, project?.path ?? null);
  const [filterCategory, setFilterCategory] = useState<SkillCategory | "all">("all");
  const [expandedSkill, setExpandedSkill] = useState<string | null>(null);

  const filtered = skills?.filter((s) => filterCategory === "all" || s.category === filterCategory);

  const toggleExpand = useCallback((name: string) => {
    setExpandedSkill((prev) => (prev === name ? null : name));
  }, []);

  return (
    <div className="flex h-full flex-col">
      {/* Top bar */}
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border bg-bg-secondary px-3">
        <Wand2 className="h-4 w-4 text-text-muted" />
        <span className="text-xs font-medium text-text-primary">Skills</span>

        {/* Category filter */}
        <div className="ml-3 flex gap-1">
          <FilterButton
            active={filterCategory === "all"}
            onClick={() => setFilterCategory("all")}
            label="All"
          />
          {SKILL_CATEGORIES.map((cat) => (
            <FilterButton
              key={cat}
              active={filterCategory === cat}
              onClick={() => setFilterCategory(cat)}
              label={CATEGORY_LABELS[cat]}
            />
          ))}
        </div>

        {skills && (
          <span className="ml-auto text-[10px] text-text-muted">
            {skills.filter((s) => s.enabled).length}/{skills.length} enabled
          </span>
        )}
      </div>

      {/* Content */}
      {!filtered || filtered.length === 0 ? (
        <div className="flex h-full items-center justify-center">
          <EmptyState
            icon={<Wand2 className="h-8 w-8 text-text-muted" />}
            title="No skills found"
            description="Skills are loaded from ~/.exegol/skills/ (global) and .exegol/skills/ (project). Restart the app to install defaults."
          />
        </div>
      ) : (
        <ScrollArea className="flex-1">
          <div className="space-y-2 p-3">
            {filtered.map((skill) => (
              <SkillCard
                key={skill.name}
                skill={skill}
                projectId={projectId}
                expanded={expandedSkill === skill.name}
                onToggleExpand={() => toggleExpand(skill.name)}
              />
            ))}
          </div>
        </ScrollArea>
      )}
    </div>
  );
}

// ─── Filter button ───────────────────────────────────────────────────────────

function FilterButton({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded px-2 py-0.5 text-[10px] font-medium transition-colors",
        active ? "bg-accent/20 text-accent" : "text-text-muted hover:text-text-secondary",
      )}
    >
      {label}
    </button>
  );
}

// ─── Skill card ──────────────────────────────────────────────────────────────

function SkillCard({
  skill,
  projectId,
  expanded,
  onToggleExpand,
}: {
  skill: SkillWithState;
  projectId: string | null;
  expanded: boolean;
  onToggleExpand: () => void;
}) {
  const toggleSkill = useToggleSkill();
  const category = skill.category as SkillCategory;

  const handleToggle = useCallback(() => {
    if (!projectId) return;
    toggleSkill.mutate({
      projectId,
      skillName: skill.name,
      enabled: !skill.enabled,
    });
  }, [projectId, skill.name, skill.enabled, toggleSkill]);

  return (
    <div
      className={cn(
        "rounded-lg border bg-bg-secondary transition-colors",
        skill.enabled ? "border-border" : "border-border/50 opacity-60",
      )}
    >
      {/* Header */}
      <div className="flex items-center gap-2 p-3">
        <button
          type="button"
          onClick={onToggleExpand}
          className="flex h-5 w-5 shrink-0 items-center justify-center text-text-muted"
        >
          {expanded ? (
            <ChevronDown className="h-3.5 w-3.5" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5" />
          )}
        </button>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onToggleExpand}
              className="text-xs font-medium text-text-primary hover:text-accent truncate"
            >
              {skill.name}
            </button>

            <Badge
              className={cn(
                "text-[9px] shrink-0",
                CATEGORY_COLORS[category] ?? CATEGORY_COLORS.custom,
              )}
            >
              {CATEGORY_LABELS[category] ?? skill.category}
            </Badge>

            <span title={skill.scope === "project" ? "Project skill" : "Global skill"}>
              {skill.scope === "project" ? (
                <FolderOpen className="h-3 w-3 shrink-0 text-amber-400" />
              ) : (
                <Globe className="h-3 w-3 shrink-0 text-text-muted" />
              )}
            </span>

            {!skill.available && (
              <span title="Missing requirements">
                <AlertTriangle className="h-3 w-3 shrink-0 text-amber-400" />
              </span>
            )}
          </div>

          {skill.role && <p className="mt-0.5 text-[10px] text-accent">{skill.role}</p>}
          <p className="mt-0.5 text-[11px] text-text-muted truncate">{skill.description}</p>
        </div>

        {/* Enable/disable toggle */}
        <button
          type="button"
          onClick={handleToggle}
          disabled={!skill.available}
          className={cn(
            "flex h-6 w-10 shrink-0 items-center rounded-full px-0.5 transition-colors",
            skill.enabled && skill.available ? "bg-accent" : "bg-bg-tertiary",
            !skill.available && "cursor-not-allowed opacity-50",
          )}
        >
          <span
            className={cn(
              "h-5 w-5 rounded-full bg-white shadow transition-transform",
              skill.enabled && skill.available ? "translate-x-4" : "translate-x-0",
            )}
          />
        </button>
      </div>

      {/* Expanded content */}
      {expanded && (
        <div className="border-t border-border px-3 pb-3 pt-2">
          {/* Metadata */}
          <div className="mb-3 flex flex-wrap gap-2">
            {skill.allowedTools.length > 0 && (
              <div className="flex items-center gap-1">
                <Shield className="h-3 w-3 text-text-muted" />
                <span className="text-[10px] text-text-muted">
                  Tools: {skill.allowedTools.join(", ")}
                </span>
              </div>
            )}
          </div>

          {/* Requirements */}
          {(skill.requires.bins.length > 0 || skill.requires.env.length > 0) && (
            <div className="mb-3 rounded bg-bg-tertiary p-2">
              <p className="text-[10px] font-medium text-text-secondary mb-1">Requirements</p>
              {skill.requires.bins.map((bin) => (
                <RequirementItem key={bin} label={bin} type="bin" />
              ))}
              {skill.requires.env.map((env) => (
                <RequirementItem key={env} label={env} type="env" />
              ))}
            </div>
          )}

          {/* Content preview */}
          <div className="max-h-60 overflow-y-auto rounded bg-bg-tertiary p-2">
            <pre className="whitespace-pre-wrap text-[11px] text-text-secondary font-mono">
              {skill.content.slice(0, 1500)}
              {skill.content.length > 1500 && "\n\n... (truncated)"}
            </pre>
          </div>

          <p className="mt-2 text-[9px] text-text-muted truncate">{skill.filePath}</p>
        </div>
      )}
    </div>
  );
}

// ─── Requirement item ────────────────────────────────────────────────────────

function RequirementItem({ label, type }: { label: string; type: "bin" | "env" }) {
  return (
    <div className="flex items-center gap-1.5 text-[10px]">
      <span className="text-text-muted">{type === "bin" ? "CLI:" : "ENV:"}</span>
      <code className="text-text-secondary">{label}</code>
    </div>
  );
}
