export type Project = {
  id: string;
  name: string;
  path: string;
  gitRemote: string | null;
  defaultBranch: string;
  defaultIde: string;
  createdAt: number;
  lastOpenedAt: number;
  /** T146: sidebar folder grouping — null means ungrouped (root level) */
  groupId: string | null;
  sortOrder: number;
};

export type ProjectCreate = Omit<
  Project,
  "id" | "createdAt" | "lastOpenedAt" | "groupId" | "sortOrder"
>;
