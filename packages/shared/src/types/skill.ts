export const SKILL_CATEGORIES = [
  "architect",
  "qa",
  "debugger",
  "reviewer",
  "documenter",
  "custom",
] as const;
export type SkillCategory = (typeof SKILL_CATEGORIES)[number];

export type SkillRequirements = {
  bins: string[];
  env: string[];
};

export type Skill = {
  name: string;
  description: string;
  category: SkillCategory;
  role: string | null;
  requires: SkillRequirements;
  allowedTools: string[];
  content: string;
  filePath: string;
  scope: "global" | "project";
  available: boolean;
};

export type SkillState = {
  id: string;
  projectId: string;
  skillName: string;
  enabled: boolean;
};

export type SkillWithState = Skill & {
  enabled: boolean;
};
