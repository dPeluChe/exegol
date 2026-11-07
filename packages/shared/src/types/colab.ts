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
  /** Folder of an inner repo, relative to the project; "" for the whole project */
  repo: string;
  /** Free text: "blueprint", "clone of it" */
  role: string;
}
