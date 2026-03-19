import type { AgentProvider } from "@exegol/shared";
import { Button, cn, Input } from "@exegol/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ChevronDown,
  ChevronUp,
  Eye,
  EyeOff,
  Plus,
  RotateCcw,
  Shield,
  ShieldOff,
  Trash2,
} from "lucide-react";
import { useCallback, useState } from "react";
import { trpcInvoke, trpcMutate } from "../../lib/trpc-client";
import { AgentIcon } from "../common/AgentIcon";

// ─── Known yolo mode flags per CLI ──────────────────────────────────────────

const YOLO_FLAGS: Record<string, string> = {
  "claude-code": "--dangerously-skip-permissions",
  codex: "--full-auto",
  aider: "--yes-always",
  goose: "--no-confirm",
};

function useProviders() {
  return useQuery({
    queryKey: ["providers"],
    queryFn: () => trpcInvoke<AgentProvider[]>("agents.listProviders"),
    staleTime: 60_000,
  });
}

// ─── Provider Card (full visible, no collapse) ─────────────────────────────

function ProviderCard({
  provider,
  onMoveUp,
  onMoveDown,
  onRemove,
}: {
  provider: AgentProvider;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  onRemove?: () => void;
}) {
  const queryClient = useQueryClient();
  const [args, setArgs] = useState(provider.args.join(", "));
  const [dirty, setDirty] = useState(false);
  const [saved, setSaved] = useState(false);

  const yoloFlag = YOLO_FLAGS[provider.id];
  const isYolo = yoloFlag ? provider.args.includes(yoloFlag) : false;
  const isEnabled = provider.enabled !== false;

  const saveArgs = useCallback(
    async (newArgs: string[]) => {
      try {
        await trpcMutate("agents.updateProviderArgs", { id: provider.id, args: newArgs });
        queryClient.invalidateQueries({ queryKey: ["providers"] });
        setDirty(false);
        setSaved(true);
        setTimeout(() => setSaved(false), 1500);
      } catch {
        /* ignore */
      }
    },
    [provider.id, queryClient],
  );

  const handleSave = useCallback(() => {
    if (!dirty) return;
    saveArgs(
      args
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    );
  }, [args, dirty, saveArgs]);

  const toggleYolo = useCallback(() => {
    if (!yoloFlag) return;
    const current = args
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const newArgs = isYolo ? current.filter((a) => a !== yoloFlag) : [...current, yoloFlag];
    setArgs(newArgs.join(", "));
    saveArgs(newArgs);
  }, [yoloFlag, isYolo, args, saveArgs]);

  const toggleEnabled = useCallback(async () => {
    try {
      await trpcMutate("agents.toggleProviderEnabled", { id: provider.id, enabled: !isEnabled });
      queryClient.invalidateQueries({ queryKey: ["providers"] });
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
    } catch {
      /* ignore */
    }
  }, [provider.id, isEnabled, queryClient]);

  return (
    <div
      className={cn(
        "relative flex flex-col gap-2.5 rounded-xl border bg-bg-secondary p-3 transition-all",
        !isEnabled && "opacity-40",
        saved ? "border-green-500/50" : "border-border",
      )}
    >
      {/* Saved indicator */}
      {saved && (
        <span className="absolute right-2 top-2 text-[8px] font-medium text-green-400">
          saved ✓
        </span>
      )}
      {/* Top: arrows + icon + name */}
      <div className="flex items-start gap-2">
        {/* Reorder arrows */}
        <div className="flex flex-col gap-0.5 pt-1">
          <button
            type="button"
            onClick={onMoveUp}
            disabled={!onMoveUp}
            className={cn(
              "flex h-4 w-4 items-center justify-center rounded",
              onMoveUp ? "text-text-muted hover:bg-white/10 hover:text-text-primary" : "invisible",
            )}
          >
            <ChevronUp className="h-3 w-3" />
          </button>
          <button
            type="button"
            onClick={onMoveDown}
            disabled={!onMoveDown}
            className={cn(
              "flex h-4 w-4 items-center justify-center rounded",
              onMoveDown
                ? "text-text-muted hover:bg-white/10 hover:text-text-primary"
                : "invisible",
            )}
          >
            <ChevronDown className="h-3 w-3" />
          </button>
        </div>

        {/* Icon */}
        <AgentIcon
          provider={provider.id}
          size={36}
          fallback={provider.icon}
          fallbackColor={provider.color}
        />

        {/* Name + command */}
        <div className="flex-1">
          <div className="flex items-center gap-1.5">
            <span className="text-sm font-semibold text-text-primary">{provider.name}</span>
            <code className="rounded bg-bg-tertiary px-1.5 py-0.5 text-[9px] text-text-muted">
              {provider.command}
            </code>
          </div>
          {/* Capability badges */}
          <div className="mt-1 flex flex-wrap gap-1">
            {provider.capabilities.supportsPromptArg && <CapBadge label="prompt" />}
            {provider.capabilities.promptFlag && (
              <CapBadge label={`flag: ${provider.capabilities.promptFlag}`} />
            )}
            {provider.capabilities.supportsWorktree && <CapBadge label="worktree" />}
            {provider.capabilities.supportsResume && <CapBadge label="resume" />}
            {provider.capabilities.supportsVision && <CapBadge label="vision" />}
          </div>
        </div>

        {/* Action badges: Active + Safe/YOLO + Delete — same row as name */}
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={toggleEnabled}
            className={cn(
              "flex items-center gap-1 rounded-lg px-2 py-1 text-[9px] font-medium transition-all",
              isEnabled
                ? "bg-green-500/15 text-green-400 hover:bg-green-500/25"
                : "bg-white/5 text-text-muted hover:bg-white/10",
            )}
            title={isEnabled ? "Visible in launcher" : "Hidden from launcher"}
          >
            {isEnabled ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3" />}
            {isEnabled ? "Active" : "Hidden"}
          </button>
          {yoloFlag && (
            <button
              type="button"
              onClick={toggleYolo}
              className={cn(
                "flex items-center gap-1 rounded-lg px-2 py-1 text-[9px] font-medium transition-all",
                isYolo
                  ? "bg-orange-500/20 text-orange-400 hover:bg-orange-500/30"
                  : "bg-white/5 text-text-muted hover:bg-white/10",
              )}
              title={isYolo ? `Auto-approve ON (${yoloFlag})` : "Auto-approve OFF"}
            >
              {isYolo ? <ShieldOff className="h-3 w-3" /> : <Shield className="h-3 w-3" />}
              {isYolo ? "YOLO" : "Safe"}
            </button>
          )}
          {onRemove && (
            <button
              type="button"
              onClick={onRemove}
              className="flex h-6 w-6 items-center justify-center rounded text-text-muted hover:bg-red-500/10 hover:text-error"
              title="Remove"
            >
              <Trash2 className="h-3 w-3" />
            </button>
          )}
        </div>
      </div>

      {/* Default arguments */}
      <div>
        <div className="mb-1 text-[9px] text-text-muted">Default arguments</div>
        <div className="flex items-center gap-1.5">
          <Input
            value={args}
            onChange={(e) => {
              setArgs(e.target.value);
              setDirty(true);
            }}
            onBlur={handleSave}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleSave();
            }}
            placeholder="--flag, --other-flag"
            className="h-7 flex-1 border-[var(--border)] bg-[var(--bg-tertiary)] text-[10px] text-[var(--text-primary)]"
          />
          {dirty && <span className="shrink-0 text-[8px] text-accent">•</span>}
        </div>
      </div>
    </div>
  );
}

function CapBadge({ label }: { label: string }) {
  return <span className="rounded bg-white/5 px-1 py-0.5 text-[8px] text-text-muted">{label}</span>;
}

// ─── Main Component ─────────────────────────────────────────────────────────

export function CliSettings() {
  const { data: providers, isLoading } = useProviders();
  const queryClient = useQueryClient();

  const builtins = providers?.filter((p) => p.isBuiltin && p.id !== "shell") ?? [];
  const customs = providers?.filter((p) => !p.isBuiltin) ?? [];

  const handleAddCustom = useCallback(async () => {
    try {
      await trpcMutate("agents.registerProvider", {
        id: `custom-${Date.now()}`,
        name: "New Agent",
        command: "my-agent",
      });
      queryClient.invalidateQueries({ queryKey: ["providers"] });
    } catch {
      /* ignore */
    }
  }, [queryClient]);

  const handleRemoveCustom = useCallback(
    async (id: string) => {
      try {
        await trpcMutate("agents.unregisterProvider", { id });
        queryClient.invalidateQueries({ queryKey: ["providers"] });
      } catch {
        /* ignore */
      }
    },
    [queryClient],
  );

  const handleResetArgs = useCallback(async () => {
    try {
      await trpcMutate("agents.resetProviderArgs");
      queryClient.invalidateQueries({ queryKey: ["providers"] });
    } catch {
      /* ignore */
    }
  }, [queryClient]);

  const allProviders = [...builtins, ...customs];

  const handleSwap = useCallback(
    async (idA: string, idB: string) => {
      try {
        await trpcMutate("agents.swapProviders", { idA, idB });
        queryClient.invalidateQueries({ queryKey: ["providers"] });
      } catch {
        /* ignore */
      }
    },
    [queryClient],
  );

  if (isLoading) {
    return <p className="text-xs text-text-muted">Loading providers...</p>;
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <Button
          variant="outline"
          size="sm"
          onClick={handleAddCustom}
          className="gap-1 border-[var(--border)] text-[var(--text-secondary)] hover:bg-white/5"
        >
          <Plus className="h-3.5 w-3.5" />
          Add Custom Agent
        </Button>
        <button
          type="button"
          onClick={handleResetArgs}
          className="flex items-center gap-1 text-[9px] text-text-muted hover:text-text-secondary"
          title="Reset all arguments to defaults"
        >
          <RotateCcw className="h-3 w-3" />
          Reset
        </button>
      </div>

      {/* Grid of cards */}
      <div className="grid grid-cols-1 gap-2 xl:grid-cols-2 2xl:grid-cols-3">
        {allProviders.map((p, i) => (
          <ProviderCard
            key={p.id}
            provider={p}
            // biome-ignore lint/style/noNonNullAssertion: bounds checked by i > 0 / i < length - 1
            onMoveUp={i > 0 ? () => handleSwap(p.id, allProviders[i - 1]!.id) : undefined}
            onMoveDown={
              i < allProviders.length - 1
                ? // biome-ignore lint/style/noNonNullAssertion: bounds checked
                  () => handleSwap(p.id, allProviders[i + 1]!.id)
                : undefined
            }
            onRemove={!p.isBuiltin ? () => handleRemoveCustom(p.id) : undefined}
          />
        ))}
      </div>
    </div>
  );
}
