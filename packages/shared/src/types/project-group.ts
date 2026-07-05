export type ProjectGroup = {
  id: string;
  name: string;
  /** Hex color for the group's dot/tint, e.g. "#3B82F6" */
  color: string | null;
  /** lucide-react icon name, e.g. "Layers" */
  icon: string | null;
  /** Optional subtle background tint override (falls back to color at low opacity) */
  background: string | null;
  sortOrder: number;
  collapsed: boolean;
  createdAt: number;
};

export type ProjectGroupCreate = Omit<ProjectGroup, "id" | "sortOrder" | "collapsed" | "createdAt">;
