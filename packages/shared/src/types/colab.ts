export const COLAB_NAME_MAX = 60;
export const COLAB_PURPOSE_MAX = 500;
export const COLAB_ROLE_MAX = 60;

/** A space between related projects: their shared inbox, and notes later */
export interface Colab {
  id: string;
  name: string;
  /** What belongs here; agents read it */
  purpose: string;
  createdAt: number;
  members: ColabMember[];
}

export interface ColabMember {
  projectId: string;
  projectName: string;
  /** Folder of an inner repo, relative to the project; "" for the whole project */
  repo: string;
  /** A free note about it: "blueprint", "clone of it" */
  role: string;
  /** The main dev: its sessions make the changes the colab's threads ask for. One in a colab
   *  with members; the others are user devs, who use it and report */
  main: boolean;
}

export const MEMBER_ROLE = {
  main: { label: "main dev", does: "makes the changes" },
  user: { label: "user dev", does: "uses it and reports" },
} as const;

export const memberRole = (m: Pick<ColabMember, "main">) =>
  m.main ? MEMBER_ROLE.main : MEMBER_ROLE.user;

export const colabsOf = (colabs: Colab[], projectId: string) =>
  colabs.filter((c) => c.members.some((m) => m.projectId === projectId));

export const colabIdsOf = (colabs: Colab[], projectId: string) =>
  new Set(colabsOf(colabs, projectId).map((c) => c.id));
