export type Project = {
  id: string;
  name: string;
  path: string;
  gitRemote: string | null;
  defaultBranch: string;
  createdAt: number;
  lastOpenedAt: number;
  /** T146: sidebar folder grouping — null means ungrouped (root level) */
  groupId: string | null;
  sortOrder: number;
  /** Chosen color (hex) and built-in icon name, shown wherever the project is listed */
  color?: string | null;
  icon?: string | null;
  /** An image file inside the project used as its icon (favicon, app icon) */
  iconImage?: string | null;
  /** Hosts beyond the local ones its agents may open in the browser pane ("*.app.com") */
  browserHosts?: string[];
  /** The IDE it opens in; null follows Settings */
  ide?: string | null;
  /** browser_eval allowed for its agents (off by default) */
  browserEval?: boolean;
};

export type ProjectCreate = Omit<
  Project,
  "id" | "createdAt" | "lastOpenedAt" | "groupId" | "sortOrder"
>;
