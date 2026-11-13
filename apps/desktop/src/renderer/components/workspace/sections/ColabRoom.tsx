import { COLAB_ROLE_MAX, type Colab, type ColabMember, type Project } from "@exegol/shared";
import { cn } from "@exegol/ui";
import { Check, Plus, Search, Star, X } from "lucide-react";
import { useState } from "react";
import { useAct } from "../../../hooks/use-act";
import { useProjectShapes } from "../../../hooks/use-project-shapes";
import { useProjects } from "../../../hooks/use-trpc";
import { joinable, memberKey } from "../../../lib/colab-room";
import { ProjectAvatar } from "../../common/ProjectAvatar";

const LABEL = "text-[10px] uppercase tracking-wide text-text-muted";

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
  const [role, setRole] = useState(member.role);
  const at = { colabId, projectId: member.projectId, repo: member.repo };
  const saveRole = () => {
    if (role.trim() !== member.role) void act("colabs.addMember", { ...at, role });
  };

  return (
    <div
      className={cn(
        "relative flex flex-col gap-2 rounded-lg border bg-bg-tertiary p-3",
        member.main ? "border-[var(--accent)]/70" : "border-border",
      )}
    >
      <button
        type="button"
        aria-label={`Remove ${member.projectName}`}
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
      <input
        value={role}
        onChange={(e) => setRole(e.target.value)}
        onBlur={saveRole}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
        }}
        maxLength={COLAB_ROLE_MAX}
        placeholder="Its role: blueprint, clone of it"
        aria-label={`Role of ${member.projectName}`}
        className="w-full rounded border border-border bg-bg-secondary px-2 py-1 text-[11px] text-text-primary outline-none placeholder:text-text-muted focus:border-accent/50"
      />
      <button
        type="button"
        aria-pressed={member.main}
        disabled={busy}
        onClick={() => void act("colabs.setMain", { ...at, main: !member.main })}
        title="The main member does the work the colab's threads ask for"
        className={cn(
          "flex items-center gap-1.5 self-start rounded-full border px-2 py-0.5 text-[10px] transition-colors",
          member.main
            ? "border-[var(--accent)]/70 bg-[var(--accent)]/15 text-text-primary"
            : "border-border text-text-muted hover:text-text-primary",
        )}
      >
        <Star className={cn("h-3 w-3", member.main && "fill-current")} />
        {member.main ? "Main: does the work" : "Make it the main one"}
      </button>
    </div>
  );
}

function AddProjects({ colab, projects }: { colab: Colab; projects: Project[] }) {
  const shapes = useProjectShapes();
  const { busy, act } = useAct("Not added");
  const [query, setQuery] = useState("");
  const [inside, setInside] = useState<string | null>(null);
  const list = joinable(projects, colab.members, query);
  const add = (projectId: string, repo: string) =>
    void act("colabs.addMember", { colabId: colab.id, projectId, repo, role: "" });
  const repos = inside ? (shapes?.[inside]?.repos ?? []) : [];
  const taken = new Set(colab.members.map(memberKey));

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <span className={LABEL}>Add projects</span>
        <label className="ml-auto flex w-48 items-center gap-1.5 rounded border border-border bg-bg-secondary px-2 py-1">
          <Search className="h-3 w-3 shrink-0 text-text-muted" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search projects"
            className="w-full min-w-0 bg-transparent text-[11px] text-text-primary outline-none placeholder:text-text-muted"
          />
        </label>
      </div>
      <div className="grid max-h-56 grid-cols-2 gap-1.5 overflow-y-auto sm:grid-cols-3">
        {list.map(({ project, joined }) => {
          const inner = shapes?.[project.id]?.repos.length ?? 0;
          return (
            <button
              key={project.id}
              type="button"
              disabled={busy || joined}
              onClick={() => (inner > 0 ? setInside(project.id) : add(project.id, ""))}
              className={cn(
                "flex items-center gap-2 rounded-md border px-2 py-1.5 text-left text-[11px] transition-colors",
                joined
                  ? "border-border text-text-muted"
                  : "border-border text-text-primary hover:border-[var(--accent)]/60 hover:bg-white/5",
                inside === project.id && "border-[var(--accent)]/60",
              )}
            >
              <ProjectAvatar project={project} className="h-4 w-4" />
              <span className="min-w-0 flex-1 truncate">{project.name}</span>
              {joined ? (
                <Check className="h-3 w-3 shrink-0" />
              ) : inner > 0 ? (
                <span className="shrink-0 text-[10px] text-text-muted">{inner} repos</span>
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
        <div className="flex flex-wrap items-center gap-1.5 rounded-md border border-border bg-bg-tertiary p-2">
          <span className="text-[11px] text-text-secondary">
            {projects.find((p) => p.id === inside)?.name} is a workspace. Which part takes part?
          </span>
          {["", ...repos].map((repo) => (
            <button
              key={repo}
              type="button"
              disabled={busy || taken.has(memberKey({ projectId: inside, repo }))}
              onClick={() => {
                add(inside, repo);
                setInside(null);
              }}
              className="rounded-full border border-border px-2 py-0.5 text-[10px] text-text-primary hover:border-[var(--accent)]/60 disabled:text-text-muted"
            >
              {repo || "Whole project"}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setInside(null)}
            className="ml-auto text-[10px] text-text-muted hover:text-text-primary"
          >
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}

/** A colab's members as a room: a card per project, one marked as the main, and a picker */
export function ColabRoom({ colab }: { colab: Colab }) {
  const { data: projects = [] } = useProjects();
  const byId = new Map(projects.map((p) => [p.id, p]));
  const hasMain = colab.members.some((m) => m.main);

  return (
    <div className="flex flex-col gap-3 border-t border-border pt-3">
      <div className="flex items-baseline gap-2">
        <span className={LABEL}>In this colab</span>
        <span className="text-[10px] text-text-muted">
          {colab.members.length === 0
            ? "Nobody yet: pick the projects that work together"
            : hasMain
              ? "The main one does the work; the others report to it"
              : "No main member: mark the one that does the work"}
        </span>
      </div>
      {colab.members.length > 0 && (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {colab.members.map((m) => (
            <MemberCard
              key={memberKey(m)}
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
