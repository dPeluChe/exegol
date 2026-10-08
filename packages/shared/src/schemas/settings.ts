import { z } from "zod";
import { DEFAULT_DICTATION_SETTINGS, parseChord } from "../types/dictation";
import { IDE_IDS } from "../types/ide";
import { DEFAULT_SETTINGS } from "../types/settings";

export const ideTypeSchema = z.enum(IDE_IDS);

export const agentCliConfigSchema = z.object({
  cliType: z.string().min(1),
  command: z.string().min(1),
  args: z.array(z.string()),
  env: z.record(z.string(), z.string()),
});

export const dictationSettingsSchema = z.object({
  enabled: z.boolean(),
  shortcut: z
    .string()
    .max(40)
    .refine((s) => parseChord(s) !== null, "a shortcut needs Cmd or Ctrl and one key"),
  pressEnter: z.boolean(),
  pauseMedia: z.boolean(),
  pauseMediaDirect: z.boolean(),
  idleUnloadMinutes: z.number().int().min(1).max(240),
  maxSeconds: z.number().int().min(10).max(600),
  autoStopSilenceSec: z.number().int().min(0).max(60),
  retentionDays: z.number().int().min(1).max(3650),
  retentionMax: z.number().int().min(10).max(10_000),
});

export const settingsSchema = z.object({
  defaultIde: ideTypeSchema.default("vscode"),
  customIdePath: z.string().nullable().default(null),
  theme: z.enum(["dark", "dark-black", "light", "system"]).default("dark"),
  agentClis: z.array(agentCliConfigSchema).default([]),
  globalHotkey: z.string().default("CommandOrControl+Shift+E"),
  terminalFontSize: z.number().int().min(8).max(32).default(14),
  terminalFontFamily: z.string().default("Menlo, Monaco, monospace"),
  notificationsEnabled: z.boolean().default(true),
  toastsEnabled: z.boolean().default(true),
  saveWorktreeWork: z.boolean().default(true),
  mutedNotificationChannels: z.array(z.string()).default([]),
  ollamaUrl: z.string().default(DEFAULT_SETTINGS.ollamaUrl),
  ollamaModel: z.string().default(DEFAULT_SETTINGS.ollamaModel),
  mcpVerboseLogging: z.boolean().default(false),
  statusBarWidgets: z
    .array(
      z.object({
        id: z.string().regex(/^[a-z][a-z-]{0,39}$/),
        on: z.boolean(),
        bar: z.enum(["footer", "header"]).optional(),
        slot: z.enum(["left", "center", "right"]),
        mode: z.enum(["percent", "values"]).optional(),
      }),
    )
    .max(50)
    .default([]),
  dictation: dictationSettingsSchema.default(DEFAULT_DICTATION_SETTINGS),
});

export type SettingsSchema = z.infer<typeof settingsSchema>;
