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

/** One model, or a main model with role models (advisor, subagents...) */
export type ModelMode = "single" | "combo";

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
    name: "Sonnet with an advisor",
    model: "sonnet",
    roles: { advisor: "opus", subagents: "haiku" },
  },
  {
    id: "builtin-opus-workers",
    cliType: "claude-code",
    name: "Opus leads",
    model: "opus",
    roles: { subagents: "sonnet" },
  },
];

interface ModelPresetStore {
  saved: ModelPreset[];
  /** Last mode picked per CLI; absent = single */
  modes: Record<string, ModelMode>;
  save: (preset: Omit<ModelPreset, "id">) => void;
  remove: (id: string) => void;
  setMode: (cliType: string, mode: ModelMode) => void;
}

export const useModelPresetStore = create<ModelPresetStore>()(
  persist(
    (set) => ({
      saved: [],
      modes: {},
      save: (preset) => set((s) => ({ saved: [...s.saved, { ...preset, id: nanoid(8) }] })),
      remove: (id) => set((s) => ({ saved: s.saved.filter((p) => p.id !== id) })),
      setMode: (cliType, mode) => set((s) => ({ modes: { ...s.modes, [cliType]: mode } })),
    }),
    { name: "exegol-model-presets" },
  ),
);
