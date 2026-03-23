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

export type SkillTrust = "official" | "community" | "local";

export type SkillSource = {
  type: "builtin" | "github" | "local-import";
  repo?: string;
  commitSha?: string;
  installedAt: number;
  trust: SkillTrust;
};

export type SkillLockEntry = {
  name: string;
  source: SkillSource;
  checksum?: string;
};

export type SkillLockFile = {
  version: 1;
  skills: SkillLockEntry[];
};

export type SkillInstallRequest = {
  repo: string;
  scope: "global" | "project";
  projectPath?: string;
};

export type SkillInstallResult = {
  installed: string[];
  skipped: string[];
  errors: string[];
};

export type SkillRegistryEntry = {
  name: string;
  repo: string;
  description: string;
  trust: SkillTrust;
  tags: string[];
  author: string;
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
  source?: SkillSource;
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

export type ImportCandidateSkill = {
  name: string;
  sourcePath: string;
  alreadyExists: boolean;
  isSymlink: boolean;
};

export type ImportCandidate = {
  agent: string;
  sourceDir: string;
  skills: ImportCandidateSkill[];
};
