const SECTIONS = {
  project: [
    { label: "Tasks", sections: [{ id: "tasks", label: "Tasks" }] },
    { label: "History", sections: [{ id: "history", label: "History" }] },
    {
      label: "Context",
      sections: [
        { id: "notes", label: "Notes" },
        { id: "memory", label: "Memory" },
        { id: "knowledge", label: "Knowledge" },
      ],
    },
    { label: "Prompts & Skills", sections: [{ id: "prompts-skills", label: "Prompts & Skills" }] },
    {
      label: "Automation",
      sections: [
        { id: "pipelines", label: "Pipelines" },
        { id: "parallel-runs", label: "Parallel Runs" },
        { id: "qa-tests", label: "QA Tests" },
      ],
    },
  ],
  monitor: [
    { label: "Usage", sections: [{ id: "usage", label: "Usage" }] },
    { label: "Resources", sections: [{ id: "resources-tokens", label: "Resources" }] },
    { label: "Scoring", sections: [{ id: "scoring", label: "Scoring" }] },
  ],
} as const;

export type MainTab = keyof typeof SECTIONS;

// Derived, so a new section with no group or no component fails to compile (LAZY_SECTIONS)
export type WorkspaceSection =
  | "agents"
  | (typeof SECTIONS)[MainTab][number]["sections"][number]["id"];

interface Section {
  id: WorkspaceSection;
  label: string;
}

export interface SectionGroup {
  label: string;
  sections: readonly [Section, ...Section[]];
}

export const SECTION_GROUPS: Record<MainTab, readonly [SectionGroup, ...SectionGroup[]]> = SECTIONS;

const PLACES = new Map(
  (["project", "monitor"] as const).flatMap((tab) =>
    SECTION_GROUPS[tab].flatMap((group) =>
      group.sections.map(({ id }) => [id, { tab, group }] as const),
    ),
  ),
);

/** null for "agents": the layout tabs belong to no main tab */
export function mainTabOf(section: WorkspaceSection): MainTab | null {
  return PLACES.get(section)?.tab ?? null;
}

export function groupOf(section: WorkspaceSection): SectionGroup | null {
  return PLACES.get(section)?.group ?? null;
}

/** Where a click on Project or Monitor lands: its first section, or back to the tabs if open */
export function toggleMainTab(tab: MainTab, current: WorkspaceSection): WorkspaceSection {
  return mainTabOf(current) === tab ? "agents" : SECTION_GROUPS[tab][0].sections[0].id;
}
