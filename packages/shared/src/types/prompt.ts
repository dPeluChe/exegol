export const PROMPT_CATEGORIES = ["task", "review", "debug", "custom"] as const;
export type PromptCategory = (typeof PROMPT_CATEGORIES)[number];

export type Prompt = {
  id: string;
  projectId: string;
  title: string;
  content: string;
  category: PromptCategory;
  pinned: boolean;
  createdAt: number;
  updatedAt: number;
};

export type PromptCreate = {
  projectId: string;
  title: string;
  content: string;
  category: PromptCategory;
};

export type PromptUpdate = {
  title?: string;
  content?: string;
  category?: PromptCategory;
};
