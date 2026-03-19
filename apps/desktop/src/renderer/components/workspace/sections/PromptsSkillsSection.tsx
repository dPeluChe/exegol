import { cn } from "@exegol/ui";
import { FileText, Wand2 } from "lucide-react";
import { useState } from "react";
import { PromptsSection } from "./PromptsSection";
import { SkillsSection } from "./SkillsSection";

type ActiveView = "prompts" | "skills";

export function PromptsSkillsSection() {
  const [active, setActive] = useState<ActiveView>("prompts");

  return (
    <div className="flex h-full flex-col">
      {/* Toggle bar */}
      <div className="flex h-8 shrink-0 items-center gap-1 border-b border-border/50 bg-bg-secondary/50 px-3">
        <ToggleButton
          icon={FileText}
          label="Prompts"
          isActive={active === "prompts"}
          onClick={() => setActive("prompts")}
        />
        <ToggleButton
          icon={Wand2}
          label="Skills"
          isActive={active === "skills"}
          onClick={() => setActive("skills")}
        />
      </div>

      {/* Content */}
      <div className="flex-1 overflow-hidden">
        {active === "prompts" && <PromptsSection />}
        {active === "skills" && <SkillsSection />}
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
  icon: typeof FileText;
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
