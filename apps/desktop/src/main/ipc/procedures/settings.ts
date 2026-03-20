import { DEFAULT_SETTINGS, type Settings, settingsSchema } from "@exegol/shared";
import { z } from "zod";
import type { Context } from "../context";
import { publicProcedure, router } from "../trpc";

// ─── Model Pricing Catalog (T19) ─────────────────────────────────────────

const DEFAULT_MODEL_CATALOG: Record<string, { input: number; output: number }> = {
  "claude-opus-4-6": { input: 15 / 1e6, output: 75 / 1e6 },
  "claude-sonnet-4-6": { input: 3 / 1e6, output: 15 / 1e6 },
  "claude-haiku-4-5-20251001": { input: 0.8 / 1e6, output: 4 / 1e6 },
  "gpt-4o": { input: 2.5 / 1e6, output: 10 / 1e6 },
  "gpt-4o-mini": { input: 0.15 / 1e6, output: 0.6 / 1e6 },
  o3: { input: 10 / 1e6, output: 40 / 1e6 },
  "o4-mini": { input: 1.1 / 1e6, output: 4.4 / 1e6 },
  "gemini-2.5-pro": { input: 1.25 / 1e6, output: 10 / 1e6 },
  "gemini-2.5-flash": { input: 0.15 / 1e6, output: 0.6 / 1e6 },
};

function getModelCatalog(db: Context["db"]): Record<string, { input: number; output: number }> {
  const row = db.prepare("SELECT value FROM settings WHERE key = 'model_catalog'").get() as
    | { value: string }
    | undefined;
  if (!row) return { ...DEFAULT_MODEL_CATALOG };
  try {
    const custom = JSON.parse(row.value) as Record<string, { input: number; output: number }>;
    return { ...DEFAULT_MODEL_CATALOG, ...custom };
  } catch {
    return { ...DEFAULT_MODEL_CATALOG };
  }
}

function getSettingsFromDb(db: Context["db"]): Settings {
  const row = db.prepare("SELECT value FROM settings WHERE key = 'app_settings'").get() as
    | { value: string }
    | undefined;

  if (!row) {
    return { ...DEFAULT_SETTINGS };
  }

  try {
    const parsed = JSON.parse(row.value);
    // Merge with defaults to ensure new fields are present
    return { ...DEFAULT_SETTINGS, ...parsed };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

function saveSettingsToDb(db: Context["db"], settings: Settings): void {
  const json = JSON.stringify(settings);
  db.prepare(
    `INSERT INTO settings (key, value) VALUES ('app_settings', ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  ).run(json);
}

export const settingsRouter = router({
  get: publicProcedure.query(({ ctx }) => {
    return getSettingsFromDb(ctx.db);
  }),

  update: publicProcedure.input(settingsSchema.partial()).mutation(({ ctx, input }) => {
    const current = getSettingsFromDb(ctx.db);
    const updated: Settings = { ...current, ...input };
    saveSettingsToDb(ctx.db, updated);
    return updated;
  }),

  /** T19: Get dynamic model pricing catalog (DB-backed with defaults) */
  modelCatalog: publicProcedure.query(({ ctx }) => {
    return getModelCatalog(ctx.db);
  }),

  /** T19: Update model pricing (merges with existing) */
  updateModelCatalog: publicProcedure
    .input(z.record(z.string(), z.object({ input: z.number(), output: z.number() })))
    .mutation(({ ctx, input }) => {
      const current = getModelCatalog(ctx.db);
      const updated = { ...current, ...input };
      ctx.db
        .prepare(
          `INSERT INTO settings (key, value) VALUES ('model_catalog', ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
        )
        .run(JSON.stringify(updated));
      return updated;
    }),
});
