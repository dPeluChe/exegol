import { cn } from "@exegol/ui";
import { GitBranch, History } from "lucide-react";
import { useState } from "react";
import { DiffSection } from "./sections/DiffSection";
import { OplogSection } from "./sections/OplogSection";

type GitView = "diff" | "oplog";

export function GitPane() {
  const [view, setView] = useState<GitView>("diff");

  return (
    <div className="flex h-full flex-col">
      {/* Toggle bar */}
      <div className="flex h-8 shrink-0 items-center gap-1 border-b border-border/50 bg-bg-secondary/50 px-3">
        <button
          type="button"
          onClick={() => setView("diff")}
          className={cn(
            "flex items-center gap-1 rounded px-2 py-1 text-[10px] font-medium transition-colors",
            view === "diff"
              ? "bg-accent/15 text-accent"
              : "text-text-muted hover:bg-white/5 hover:text-text-secondary",
          )}
        >
          <GitBranch className="h-3 w-3" />
          Changes
        </button>
        <button
          type="button"
          onClick={() => setView("oplog")}
          className={cn(
            "flex items-center gap-1 rounded px-2 py-1 text-[10px] font-medium transition-colors",
            view === "oplog"
              ? "bg-accent/15 text-accent"
              : "text-text-muted hover:bg-white/5 hover:text-text-secondary",
          )}
        >
          <History className="h-3 w-3" />
          Agent Operations
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-hidden">
        {view === "diff" && <DiffSection />}
        {view === "oplog" && <OplogSection />}
      </div>
    </div>
  );
}
