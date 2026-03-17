export type Project = {
  id: string;
  name: string;
  path: string;
  gitRemote: string | null;
  defaultBranch: string;
  defaultIde: string;
  createdAt: number;
  lastOpenedAt: number;
};

export type ProjectCreate = Omit<Project, "id" | "createdAt" | "lastOpenedAt">;
