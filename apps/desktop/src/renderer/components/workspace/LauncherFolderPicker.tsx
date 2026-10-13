import type { FolderKind, LauncherFolder } from "@exegol/shared";
import { cn } from "@exegol/ui";
import { ChevronDown, Folder, FolderGit2, RefreshCw } from "lucide-react";
import { useRef, useState } from "react";
import { useMountEffect } from "../../hooks/use-mount-effect";
import { folderFilterKeys, folderRowLabel, matchFolders } from "../../lib/launcher";

import { Kbd } from "../common/Kbd";

const KIND_LABEL: Record<FolderKind, string> = {
  git: "git",
  node: "node",
  xcode: "xcode",
  swift: "swift",
  "expo-prebuilt": "expo",
  "expo-managed": "expo managed",
};

function KindBadges({ kinds }: { kinds: FolderKind[] }) {
  return (
    <span className="flex shrink-0 gap-0.5">
      {kinds.map((k) => (
        <span key={k} className="rounded bg-bg-tertiary px-1 text-[8px] text-text-muted">
          {KIND_LABEL[k]}
        </span>
      ))}
    </span>
  );
}

/** T204: "project / folder ▾", the launcher's folder; open, a filter over the project's folders
 *  (arrows, Enter, Esc). Everything the launcher opens starts there */
export function LauncherFolderPicker({
  projectName,
  folders,
  selected,
  open,
  onOpen,
  onClose,
  onSelect,
  onRefresh,
  refreshing,
  compact,
}: {
  projectName: string;
  folders: LauncherFolder[];
  selected: LauncherFolder;
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
  onSelect: (rel: string) => void;
  onRefresh: () => void;
  refreshing: boolean;
  compact: boolean;
}) {
  const Icon = selected.git ? FolderGit2 : Folder;
  return (
    <div className="flex w-full max-w-sm shrink-0 flex-col items-center gap-1">
      <button
        type="button"
        onClick={open ? onClose : onOpen}
        aria-expanded={open}
        title={`${selected.path} (/ or ${folderFilterKeys()} to change)`}
        className={cn(
          "flex max-w-full items-center gap-1.5 rounded-lg px-2 py-1 hover:bg-white/5",
          compact ? "text-[11px]" : "text-[13px]",
        )}
      >
        <Icon className="h-3.5 w-3.5 shrink-0 text-accent" />
        <span className="truncate font-semibold text-text-primary">{projectName}</span>
        {selected.rel && (
          <>
            <span className="text-text-muted">/</span>
            <span className="truncate font-semibold text-text-primary">{selected.rel}</span>
          </>
        )}
        <ChevronDown className="h-3 w-3 shrink-0 text-text-muted" />
        {!compact && <Kbd className="h-4 min-w-4 px-1 text-[9px]">/</Kbd>}
      </button>
      {open && (
        <FolderList
          folders={folders}
          selectedRel={selected.rel}
          onSelect={onSelect}
          onClose={onClose}
          onRefresh={onRefresh}
          refreshing={refreshing}
        />
      )}
    </div>
  );
}

function FolderList({
  folders,
  selectedRel,
  onSelect,
  onClose,
  onRefresh,
  refreshing,
}: {
  folders: LauncherFolder[];
  selectedRel: string;
  onSelect: (rel: string) => void;
  onClose: () => void;
  onRefresh: () => void;
  refreshing: boolean;
}) {
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  // Opened by a key or a click to type a filter right away
  useMountEffect(() => inputRef.current?.focus());
  const [cursor, setCursor] = useState(0);
  const shown = matchFolders(folders, query);
  const active = Math.min(cursor, Math.max(0, shown.length - 1));

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const step = e.key === "ArrowDown" ? 1 : -1;
      setCursor((active + step + shown.length) % Math.max(1, shown.length));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const pick = shown[active];
      if (pick) onSelect(pick.rel);
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      onClose();
    }
  };

  return (
    <div className="flex w-full flex-col gap-1 rounded-lg border border-border bg-bg-secondary p-1.5">
      <div className="flex items-center gap-1">
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setCursor(0);
          }}
          onKeyDown={onKeyDown}
          placeholder="Filter folders"
          aria-label="Filter folders"
          className="min-w-0 flex-1 rounded border border-border bg-bg-primary px-1.5 py-0.5 text-[11px] text-text-primary outline-none placeholder:text-text-muted focus:border-accent/50"
        />
        <button
          type="button"
          disabled={refreshing}
          onClick={onRefresh}
          className="p-1 text-text-muted hover:text-text-secondary disabled:opacity-60"
          title="Find the folders and their commands again"
          aria-label="Refresh folders"
        >
          <RefreshCw className={cn("h-3 w-3", refreshing && "animate-spin")} />
        </button>
      </div>
      <div className="flex max-h-48 flex-col overflow-y-auto" role="listbox">
        {shown.map((f, i) => {
          const FolderIcon = f.git ? FolderGit2 : Folder;
          return (
            <button
              key={f.rel || "(root)"}
              type="button"
              role="option"
              aria-selected={f.rel === selectedRel}
              onClick={() => onSelect(f.rel)}
              onMouseEnter={() => setCursor(i)}
              title={f.path}
              className={cn(
                "flex items-center gap-1.5 rounded px-1.5 py-1 text-left text-[11px]",
                i === active ? "bg-accent/15 text-text-primary" : "text-text-secondary",
              )}
            >
              <FolderIcon className="h-3 w-3 shrink-0" />
              <span className="min-w-0 flex-1 truncate">{folderRowLabel(f)}</span>
              {f.rel === selectedRel && <span className="text-[9px] text-accent">current</span>}
              <KindBadges kinds={f.kinds} />
            </button>
          );
        })}
        {shown.length === 0 && (
          <span className="px-1.5 py-1 text-[11px] text-text-muted">No folder matches</span>
        )}
      </div>
    </div>
  );
}
