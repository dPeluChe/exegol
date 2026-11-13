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
