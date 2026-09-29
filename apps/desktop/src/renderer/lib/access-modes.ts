import type { AgentAccessMode } from "@exegol/shared";
import type { LucideIcon } from "lucide-react";
import { Eye, FileEdit, Map as MapIcon } from "lucide-react";

export const ACCESS_MODES: {
  mode: AgentAccessMode;
  icon: LucideIcon;
  label: string;
  hint: string;
}[] = [
  { mode: "write", icon: FileEdit, label: "Full Access", hint: "Read + write files" },
  { mode: "plan", icon: MapIcon, label: "Plan Only", hint: "Analyze, no writes" },
  { mode: "read", icon: Eye, label: "Read Only", hint: "Explore codebase" },
];
