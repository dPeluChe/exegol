import { z } from "zod";
import { IDE_IDS } from "../types/ide";
import { DEFAULT_SETTINGS } from "../types/settings";

export const ideTypeSchema = z.enum(IDE_IDS);

export const agentCliConfigSchema = z.object({
  cliType: z.string().min(1),
  command: z.string().min(1),
  args: z.array(z.string()),
  env: z.record(z.string(), z.string()),
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
  mutedNotificationChannels: z.array(z.string()).default([]),
  ollamaUrl: z.string().default(DEFAULT_SETTINGS.ollamaUrl),
  ollamaModel: z.string().default(DEFAULT_SETTINGS.ollamaModel),
  mcpVerboseLogging: z.boolean().default(false),
  statusBarWidgets: z
    .array(
      z.object({
        id: z.string().regex(/^[a-z][a-z-]{0,39}$/),
        on: z.boolean(),
        slot: z.enum(["left", "center", "right"]),
        mode: z.enum(["percent", "values"]).optional(),
      }),
    )
    .max(50)
    .default([]),
});

export type SettingsSchema = z.infer<typeof settingsSchema>;
