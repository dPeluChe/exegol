import { z } from "zod";

export const ideTypeSchema = z.enum(["vscode", "cursor", "zed", "windsurf", "custom"]);

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
});

export type SettingsSchema = z.infer<typeof settingsSchema>;
