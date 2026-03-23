import type { SkillRegistryEntry, SkillTrust } from "@exegol/shared";

export const CURATED_REGISTRY: SkillRegistryEntry[] = [
  {
    name: "Vercel AI Skills",
    repo: "vercel-labs/agent-skills",
    description: "Production-grade skills for AI coding agents from Vercel",
    trust: "official",
    tags: ["fullstack", "nextjs", "deployment"],
    author: "Vercel",
  },
  {
    name: "Supabase Skills",
    repo: "supabase/agent-skills",
    description: "Database, auth, and storage skills for Supabase projects",
    trust: "official",
    tags: ["database", "auth", "backend"],
    author: "Supabase",
  },
  {
    name: "Claude Skills Collection",
    repo: "alirezarezvani/claude-skills",
    description: "Community-curated skills for Claude Code agents",
    trust: "community",
    tags: ["general", "productivity", "coding"],
    author: "alirezarezvani",
  },
  {
    name: "SkillKit Essentials",
    repo: "anthropics/skillkit",
    description: "Reference skills from the SkillKit framework",
    trust: "official",
    tags: ["reference", "patterns", "testing"],
    author: "Anthropic",
  },
];

const TRUST_MAP = new Map<string, SkillTrust>(
  CURATED_REGISTRY.map((e) => [e.repo.toLowerCase(), e.trust]),
);

export function getRegistryEntries(): SkillRegistryEntry[] {
  return CURATED_REGISTRY;
}

export function getTrustLevel(repo: string): SkillTrust {
  return TRUST_MAP.get(repo.toLowerCase()) ?? "community";
}
