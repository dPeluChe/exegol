import { COLAB_ROLE_MAX, type Colab, type ColabMember, type Project } from "@exegol/shared";
import { cn } from "@exegol/ui";
import { Check, Plus, Search, Star, X } from "lucide-react";
import { useState } from "react";
import { useAct } from "../../../hooks/use-act";
import { useProjectShapes } from "../../../hooks/use-project-shapes";
import { useProjects } from "../../../hooks/use-trpc";
import { joinable, memberKey, memberLabel } from "../../../lib/colab-room";
import { plural } from "../../../lib/plural";
import { INPUT_CLASS, LABEL_CLASS } from "../../agents/SpawnOptions";
import { ProjectAvatar } from "../../common/ProjectAvatar";

const ROLE_CHIP = "flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px]";

function MemberCard({
  colabId,
  member,
  project,
}: {
  colabId: string;
  member: ColabMember;
  project: Project | undefined;
}) {
  const { busy, act } = useAct("Member not changed");
  const at = { colabId, projectId: member.projectId, repo: member.repo };
  const label = memberLabel(member);

  return (
    <div
      className={cn(
        "relative flex flex-col gap-2 rounded-lg border bg-bg-tertiary p-3",
        member.main ? "border-[var(--accent)]/70" : "border-border",
      )}
    >
      <button
        type="button"
        aria-label={`Remove ${label}`}
        disabled={busy}
        onClick={() => void act("colabs.removeMember", at)}
        className="absolute top-1.5 right-1.5 rounded p-0.5 text-text-muted hover:bg-white/10 hover:text-text-primary"
      >
        <X className="h-3 w-3" />
      </button>
      <div className="flex items-center gap-2 pr-5">
        {project && <ProjectAvatar project={project} className="h-7 w-7" />}
        <div className="min-w-0">
          <div className="truncate text-xs font-medium text-text-primary">{member.projectName}</div>
          <div className="truncate text-[10px] text-text-muted">
            {member.repo || "Whole project"}
          </div>
        </div>
      </div>
      {member.main ? (
        <span
          className={cn(
            ROLE_CHIP,
            "self-start border-[var(--accent)]/70 bg-[var(--accent)]/15 text-text-primary",
          )}
          title="Makes the changes the colab's threads ask for. Pick another member to change it"
        >
          <Star className="h-3 w-3 fill-current" />
          Main dev: makes the changes
        </span>
      ) : (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className={cn(ROLE_CHIP, "border-border text-text-secondary")}>
            User dev: uses it and reports
          </span>
          <button
            type="button"
            disabled={busy}
            onClick={() => void act("colabs.setMain", at)}
            aria-label={`Make ${label} the main dev`}
            className={cn(
              ROLE_CHIP,
              "border-transparent text-text-muted hover:border-border hover:text-text-primary",
            )}
          >
            <Star className="h-3 w-3" />
            Make main dev
          </button>
        </div>
      )}
      <input
        defaultValue={member.role}
        onBlur={(e) => {
          const note = e.currentTarget.value.trim();
          if (note !== member.role) void act("colabs.setRole", { ...at, role: note });
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape") e.currentTarget.value = member.role;
          if (e.key === "Enter" || e.key === "Escape") e.currentTarget.blur();
        }}
        maxLength={COLAB_ROLE_MAX}
        placeholder="Note: blueprint, clone of it"
        aria-label={`Note about ${label}`}
        className={cn(INPUT_CLASS, "rounded px-2 py-1")}
      />
    </div>
  );
}

function RepoPicker({
  project,
  repos,
  taken,
  busy,
  onPick,
  onCancel,
}: {
  project: Project;
  repos: string[];
  taken: ReadonlySet<string>;
  busy: boolean;
  onPick: (repo: string) => void;
  onCancel: () => void;
}) {
  return (
    <fieldset
      onKeyDown={(e) => {
        if (e.key === "Escape") onCancel();
      }}
      className="flex flex-wrap items-center gap-1.5 rounded-md border border-border bg-bg-tertiary p-2"
    >
      <legend className="sr-only">Which part of {project.name} takes part</legend>
      <span aria-hidden className="text-[11px] text-text-secondary">
        {project.name} is a workspace. Which part takes part?
      </span>
      {["", ...repos].map((repo, i) => (
        <button
          key={repo}
          type="button"
          ref={i === 0 ? (el) => el?.focus() : undefined}
          disabled={busy || taken.has(memberKey({ projectId: project.id, repo }))}
          onClick={() => onPick(repo)}
          className="rounded-full border border-border px-2 py-0.5 text-[10px] text-text-primary hover:border-[var(--accent)]/60 disabled:text-text-muted"
        >
          {repo || "Whole project"}
        </button>
      ))}
      <button
        type="button"
        onClick={onCancel}
        className="ml-auto text-[10px] text-text-muted hover:text-text-primary"
      >
        Cancel
      </button>
    </fieldset>
  );
}

function AddProjects({ colab, projects }: { colab: Colab; projects: Project[] }) {
  const shapes = useProjectShapes();
  const { busy, act } = useAct("Not added");
  const [query, setQuery] = useState("");
  const [inside, setInside] = useState<Project | null>(null);
  const list = joinable(projects, colab.members, query);
  const add = (projectId: string, repo: string) =>
    void act("colabs.addMember", { colabId: colab.id, projectId, repo, role: "" });

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <span className={LABEL_CLASS}>Add projects</span>
        <label className="ml-auto flex w-48 items-center gap-1.5 rounded border border-border bg-bg-secondary px-2 py-1 focus-within:border-[var(--accent)]/60">
          <Search className="h-3 w-3 shrink-0 text-text-muted" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape" && query) {
                e.stopPropagation();
                setQuery("");
              }
            }}
            placeholder="Search projects"
            aria-label="Search projects"
            className="w-full min-w-0 bg-transparent text-[11px] text-text-primary outline-none placeholder:text-text-muted"
          />
        </label>
      </div>
      <div className="grid max-h-56 grid-cols-2 gap-1.5 overflow-y-auto sm:grid-cols-3">
        {list.map(({ project, joined }) => {
          const shape = shapes?.[project.id];
          const workspace = shape?.kind === "workspace" && shape.repoCount > 0;
          return (
            <button
              key={project.id}
              type="button"
              aria-disabled={joined}
              aria-expanded={workspace ? inside?.id === project.id : undefined}
              title={joined ? "Already in this colab" : undefined}
              disabled={busy}
              onClick={() => {
                if (joined) return;
                if (workspace) setInside(project);
                else add(project.id, "");
              }}
              className={cn(
                "flex items-center gap-2 rounded-md border px-2 py-1.5 text-left text-[11px] transition-colors",
                joined
                  ? "cursor-default border-border text-text-muted"
                  : "border-border text-text-primary hover:border-[var(--accent)]/60 hover:bg-white/5",
                inside?.id === project.id && "border-[var(--accent)]/60",
              )}
            >
              <ProjectAvatar project={project} className="h-4 w-4" />
              <span className="min-w-0 flex-1 truncate">{project.name}</span>
              {joined ? (
                <Check className="h-3 w-3 shrink-0" />
              ) : workspace ? (
                <span className="shrink-0 text-[10px] text-text-muted">
                  {plural(shape.repoCount, "repo")}
                </span>
              ) : (
                <Plus className="h-3 w-3 shrink-0 text-text-muted" />
              )}
            </button>
          );
        })}
        {list.length === 0 && (
          <p className="col-span-full py-3 text-center text-[11px] text-text-muted">
            No project with that name
          </p>
        )}
      </div>
      {inside && (
        <RepoPicker
          key={inside.id}
          project={inside}
          repos={shapes?.[inside.id]?.repos ?? []}
          taken={new Set(colab.members.map(memberKey))}
          busy={busy}
          onPick={(repo) => {
            add(inside.id, repo);
            setInside(null);
          }}
          onCancel={() => setInside(null)}
        />
      )}
    </div>
  );
}

/** A colab's members as a room: a card per project, the main dev marked, and a picker */
export function ColabRoom({ colab }: { colab: Colab }) {
  const { data: projects = [] } = useProjects();
  const byId = new Map(projects.map((p) => [p.id, p]));

  return (
    <div className="flex flex-col gap-3 border-t border-border pt-3">
      <div className="flex items-baseline gap-2">
        <span className={LABEL_CLASS}>In this colab</span>
        <span className="text-[10px] text-text-muted">
          {colab.members.length === 0
            ? "Nobody yet: pick the projects that work together"
            : "One main dev makes the changes; user devs use it and report to it"}
        </span>
      </div>
      {colab.members.length > 0 && (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {colab.members.map((m) => (
            <MemberCard
              key={`${memberKey(m)}:${m.role}`}
              colabId={colab.id}
              member={m}
              project={byId.get(m.projectId)}
            />
          ))}
        </div>
      )}
      <AddProjects colab={colab} projects={projects} />
    </div>
  );
}
