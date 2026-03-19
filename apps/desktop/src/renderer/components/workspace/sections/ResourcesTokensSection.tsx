import { cn } from "@exegol/ui";
import { Activity, Coins } from "lucide-react";
import { useState } from "react";
import { ResourcesSection } from "./ResourcesSection";
import { TokensSection } from "./TokensSection";

type ActiveView = "resources" | "tokens";

export function ResourcesTokensSection() {
  const [active, setActive] = useState<ActiveView>("resources");

  return (
    <div className="flex h-full flex-col">
      {/* Toggle bar */}
      <div className="flex h-8 shrink-0 items-center gap-1 border-b border-border/50 bg-bg-secondary/50 px-3">
        <ToggleButton
          icon={Activity}
          label="Resources"
          isActive={active === "resources"}
          onClick={() => setActive("resources")}
        />
        <ToggleButton
          icon={Coins}
          label="Token Usage"
          isActive={active === "tokens"}
          onClick={() => setActive("tokens")}
        />
      </div>

      {/* Content */}
      <div className="flex-1 overflow-hidden">
        {active === "resources" && <ResourcesSection />}
        {active === "tokens" && <TokensSection />}
      </div>
    </div>
  );
}

function ToggleButton({
  icon: Icon,
  label,
  isActive,
  onClick,
}: {
  icon: typeof Activity;
  label: string;
  isActive: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex items-center gap-1 rounded px-2 py-1 text-[10px] font-medium transition-colors",
        isActive
          ? "bg-accent/15 text-accent"
          : "text-text-muted hover:bg-white/5 hover:text-text-secondary",
      )}
    >
      <Icon className="h-3 w-3" />
      {label}
    </button>
  );
}
