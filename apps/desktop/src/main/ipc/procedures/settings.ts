import { type Settings, settingsSchema } from "@exegol/shared";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { registerGlobalHotkey } from "../../bootstrap/global-hotkey";
import { getAppSettings, saveAppSettings } from "../../db/queries/settings";
import { setMcpVerboseLogging } from "../../mcp/exegol-server";
import { invalidateDesktopChannelCache } from "../../notifications/channels/desktop";
import { MODEL_PRICES, type ModelPrice } from "../../tokens/pricing";
import type { Context } from "../context";
import { publicProcedure, router } from "../trpc";

// ─── Model Pricing Catalog (T19) ─────────────────────────────────────────

// The log parser's table, per token instead of per 1M
const DEFAULT_MODEL_CATALOG: Record<string, ModelPrice> = Object.fromEntries(
  Object.entries(MODEL_PRICES).map(([model, p]) => [
    model,
    { input: p.input / 1e6, output: p.output / 1e6 },
  ]),
);

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

export const settingsRouter = router({
  get: publicProcedure.query(({ ctx }) => {
    return getAppSettings(ctx.db);
  }),

  update: publicProcedure.input(settingsSchema.partial()).mutation(({ ctx, input }) => {
    const current = getAppSettings(ctx.db);
    const updated: Settings = { ...current, ...input };
    // A hotkey that cannot be registered (malformed, or owned by another app) is not saved
    if (
      updated.globalHotkey !== current.globalHotkey &&
      !registerGlobalHotkey(updated.globalHotkey)
    ) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `${updated.globalHotkey} cannot be used: it is invalid or another app owns it`,
      });
    }
    saveAppSettings(ctx.db, updated);
    // T155.7: notification prefs live in this row — drop the desktop
    // channel's 30s cache so mute toggles apply immediately.
    invalidateDesktopChannelCache();
    setMcpVerboseLogging(updated.mcpVerboseLogging === true);
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
