import type Database from "libsql";
import { getJsonSetting, setJsonSetting } from "../db/queries/settings";

const ACTIVE_VIEW_KEY = "lastActiveView";

/** What the user was looking at: the active tab's sessions (focused pane first) and its project */
export interface ActiveView {
  projectId: string | null;
  agentIds: string[];
}

const NONE: ActiveView = { projectId: null, agentIds: [] };

export function saveActiveView(db: Database.Database, view: ActiveView): void {
  setJsonSetting(db, ACTIVE_VIEW_KEY, view);
}

/** Never throws: a missing view only loses the ordering */
export function loadActiveView(db: Database.Database): ActiveView {
  let view: Partial<ActiveView> | null;
  try {
    view = getJsonSetting<Partial<ActiveView> | null>(db, ACTIVE_VIEW_KEY, NONE);
  } catch {
    return NONE;
  }
  return {
    projectId: typeof view?.projectId === "string" ? view.projectId : null,
    agentIds: Array.isArray(view?.agentIds)
      ? view.agentIds.filter((id): id is string => typeof id === "string")
      : [],
  };
}

export interface ReattachOrder {
  ids: string[];
  activeTab: string[];
  activeProject: number;
  rest: number;
}

/** Active tab first (in its own order), then the rest of the active project, then everything else */
export function orderForReattach(
  ids: string[],
  projectOf: (id: string) => string | undefined,
  view: ActiveView,
): ReattachOrder {
  const present = new Set(ids);
  const activeTab = view.agentIds.filter(
    (id, i) => present.has(id) && view.agentIds.indexOf(id) === i,
  );
  const inTab = new Set(activeTab);
  const remaining = ids.filter((id) => !inTab.has(id));
  const project = view.projectId ? remaining.filter((id) => projectOf(id) === view.projectId) : [];
  const inProject = new Set(project);
  const rest = remaining.filter((id) => !inProject.has(id));
  return {
    ids: [...activeTab, ...project, ...rest],
    activeTab,
    activeProject: project.length,
    rest: rest.length,
  };
}
