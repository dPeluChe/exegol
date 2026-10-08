import { nanoid } from "nanoid";
import { create } from "zustand";
import { persist } from "zustand/middleware";

/** A main model plus role models (MODEL_ROLES ids) for one CLI, picked in one click at launch */
export interface ModelPreset {
  id: string;
  cliType: string;
  name: string;
  model: string;
  roles: Record<string, string>;
}

/** Shipped combinations that stay within a subscription (no Fable, no usage credits) */
export const BUILT_IN_PRESETS: ModelPreset[] = [
  {
    id: "builtin-opusplan",
    cliType: "claude-code",
    name: "Opus plans, Sonnet builds",
    model: "opusplan",
    roles: {},
  },
  {
    id: "builtin-sonnet-advisor",
    cliType: "claude-code",
    name: "Sonnet + Opus advisor + Haiku subagents",
    model: "sonnet",
    roles: { advisor: "opus", subagents: "haiku" },
  },
  {
    id: "builtin-opus-workers",
    cliType: "claude-code",
    name: "Opus + Sonnet subagents",
    model: "opus",
    roles: { subagents: "sonnet" },
  },
];

interface ModelPresetStore {
  saved: ModelPreset[];
  save: (preset: Omit<ModelPreset, "id">) => void;
  remove: (id: string) => void;
}

export const useModelPresetStore = create<ModelPresetStore>()(
  persist(
    (set) => ({
      saved: [],
      save: (preset) => set((s) => ({ saved: [...s.saved, { ...preset, id: nanoid(8) }] })),
      remove: (id) => set((s) => ({ saved: s.saved.filter((p) => p.id !== id) })),
    }),
    { name: "exegol-model-presets" },
  ),
);
