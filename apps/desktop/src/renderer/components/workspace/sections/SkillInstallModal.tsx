import type { SkillRegistryEntry } from "@exegol/shared";
import { Badge, Button, cn, Input } from "@exegol/ui";
import { Download, Github, Loader2, Package, ShieldCheck, Users, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useInstallSkill, useSkillRegistry } from "../../../hooks/use-trpc-skills";

type Tab = "registry" | "github";

export function SkillInstallModal({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<Tab>("registry");

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="w-[560px] max-h-[80vh] flex flex-col rounded-xl border border-border bg-bg-primary shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <div className="flex items-center gap-2">
            <Download className="h-4 w-4 text-accent" />
            <span className="text-sm font-medium text-text-primary">Install Skills</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-text-muted hover:text-text-primary"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-border px-4">
          <TabButton
            active={tab === "registry"}
            onClick={() => setTab("registry")}
            icon={<Package className="h-3.5 w-3.5" />}
            label="Registry"
          />
          <TabButton
            active={tab === "github"}
            onClick={() => setTab("github")}
            icon={<Github className="h-3.5 w-3.5" />}
            label="GitHub"
          />
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-4">
          {tab === "registry" ? <RegistryTab onClose={onClose} /> : <GitHubTab onClose={onClose} />}
        </div>
      </div>
    </div>
  );
}

// ─── Tab button ─────────────────────────────────────────────────────────────

function TabButton({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex items-center gap-1.5 border-b-2 px-3 py-2 text-xs font-medium transition-colors",
        active
          ? "border-accent text-accent"
          : "border-transparent text-text-muted hover:text-text-secondary",
      )}
    >
      {icon}
      {label}
    </button>
  );
}

// ─── Registry tab ───────────────────────────────────────────────────────────

function RegistryTab({ onClose }: { onClose: () => void }) {
  const { data: entries } = useSkillRegistry();
  const install = useInstallSkill();

  const handleInstall = useCallback(
    (entry: SkillRegistryEntry) => {
      install.mutate({ repo: entry.repo, scope: "global" });
    },
    [install],
  );

  return (
    <div className="space-y-3">
      {!entries || entries.length === 0 ? (
        <p className="text-xs text-text-muted text-center py-8">No registry entries available</p>
      ) : (
        entries.map((entry) => (
          <RegistryCard
            key={entry.repo}
            entry={entry}
            onInstall={handleInstall}
            installing={install.isPending}
          />
        ))
      )}

      {install.isSuccess && install.data && (
        <ResultBanner result={install.data} onClose={onClose} />
      )}
    </div>
  );
}

function RegistryCard({
  entry,
  onInstall,
  installing,
}: {
  entry: SkillRegistryEntry;
  onInstall: (entry: SkillRegistryEntry) => void;
  installing: boolean;
}) {
  return (
    <div className="flex items-start gap-3 rounded-lg border border-border bg-bg-secondary p-3">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-text-primary">{entry.name}</span>
          <TrustBadge trust={entry.trust} />
        </div>
        <p className="mt-0.5 text-[11px] text-text-muted">{entry.description}</p>
        <div className="mt-1.5 flex items-center gap-1.5">
          <span className="text-[10px] text-text-muted">{entry.repo}</span>
          {entry.tags.map((tag) => (
            <Badge key={tag} className="text-[9px] bg-bg-tertiary text-text-muted">
              {tag}
            </Badge>
          ))}
        </div>
      </div>
      <Button
        size="sm"
        variant="outline"
        onClick={() => onInstall(entry)}
        disabled={installing}
        className="shrink-0 text-[11px] h-7"
      >
        {installing ? <Loader2 className="h-3 w-3 animate-spin" /> : "Install"}
      </Button>
    </div>
  );
}

// ─── GitHub tab ─────────────────────────────────────────────────────────────

function GitHubTab({ onClose }: { onClose: () => void }) {
  const [repo, setRepo] = useState("");
  const [scope, setScope] = useState<"global" | "project">("global");
  const install = useInstallSkill();

  const handleSubmit = useCallback(() => {
    if (!repo.trim()) return;
    install.mutate({ repo: repo.trim(), scope });
  }, [repo, scope, install]);

  return (
    <div className="space-y-4">
      <div>
        <span className="text-[11px] font-medium text-text-secondary mb-1.5 block">
          GitHub Repository
        </span>
        <Input
          value={repo}
          onChange={(e) => setRepo(e.target.value)}
          placeholder="owner/repo or https://github.com/owner/repo"
          className="text-xs"
          onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
        />
        <p className="mt-1 text-[10px] text-text-muted">
          Repository must contain SKILL.md files in root, skills/, or .agents/skills/
        </p>
      </div>

      <div>
        <span className="text-[11px] font-medium text-text-secondary mb-1.5 block">Scope</span>
        <div className="flex gap-2">
          <ScopeButton
            active={scope === "global"}
            onClick={() => setScope("global")}
            label="Global"
          />
          <ScopeButton
            active={scope === "project"}
            onClick={() => setScope("project")}
            label="Project"
          />
        </div>
      </div>

      <Button
        onClick={handleSubmit}
        disabled={!repo.trim() || install.isPending}
        className="w-full text-xs"
      >
        {install.isPending ? (
          <>
            <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> Cloning & installing...
          </>
        ) : (
          <>
            <Download className="h-3.5 w-3.5 mr-1.5" /> Install from GitHub
          </>
        )}
      </Button>

      {install.isError && (
        <p className="text-[11px] text-red-400">
          Installation failed. Check the repository URL and try again.
        </p>
      )}

      {install.isSuccess && install.data && (
        <ResultBanner result={install.data} onClose={onClose} />
      )}
    </div>
  );
}

function ScopeButton({
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
        "rounded-md px-3 py-1.5 text-[11px] font-medium border transition-colors",
        active
          ? "border-accent bg-accent/10 text-accent"
          : "border-border text-text-muted hover:text-text-secondary",
      )}
    >
      {label}
    </button>
  );
}

// ─── Shared ─────────────────────────────────────────────────────────────────

function TrustBadge({ trust }: { trust: string }) {
  if (trust === "official") {
    return (
      <Badge className="text-[9px] bg-green-500/20 text-green-400 gap-0.5">
        <ShieldCheck className="h-2.5 w-2.5" /> Official
      </Badge>
    );
  }
  if (trust === "community") {
    return (
      <Badge className="text-[9px] bg-yellow-500/20 text-yellow-400 gap-0.5">
        <Users className="h-2.5 w-2.5" /> Community
      </Badge>
    );
  }
  return null;
}

function ResultBanner({
  result,
  onClose,
}: {
  result: { installed: string[]; skipped: string[]; errors: string[] };
  onClose: () => void;
}) {
  return (
    <div className="rounded-lg border border-green-500/30 bg-green-500/10 p-3">
      {result.installed.length > 0 && (
        <p className="text-[11px] text-green-400">Installed: {result.installed.join(", ")}</p>
      )}
      {result.skipped.length > 0 && (
        <p className="text-[11px] text-yellow-400 mt-1">
          Skipped (already exist): {result.skipped.join(", ")}
        </p>
      )}
      {result.errors.length > 0 && (
        <p className="text-[11px] text-red-400 mt-1">Errors: {result.errors.join(", ")}</p>
      )}
      <Button size="sm" variant="outline" onClick={onClose} className="mt-2 text-[10px] h-6">
        Done
      </Button>
    </div>
  );
}
