import type { Project } from "@exegol/shared";
import type { ShortcutDigit } from "../stores/shortcuts";

/** Keyboard order: Cmd+2 first, Cmd+0 (the tenth key) last */
const digitRank = (d: ShortcutDigit) => (d === "0" ? 10 : Number(d));

/**
 * The sidebar's auto order: projects with a Cmd+n in key order, then the others with something
 * live (alphabetical), then the rest (alphabetical).
 */
export function autoOrderProjects(
  projects: Project[],
  shortcuts: Map<string, ShortcutDigit>,
  active: Set<string>,
): Project[] {
  const tier = (p: Project) => {
    const digit = shortcuts.get(p.id);
    if (digit) return digitRank(digit);
    return active.has(p.id) ? 20 : 30;
  };
  return [...projects].sort(
    (a, b) => tier(a) - tier(b) || a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
  );
}
