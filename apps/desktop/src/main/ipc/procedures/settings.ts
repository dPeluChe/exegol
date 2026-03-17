import type { Context } from '../context'
import { settingsSchema } from '@exegol/shared'
import { DEFAULT_SETTINGS, type Settings } from '@exegol/shared'
import { router, publicProcedure } from '../trpc'

function getSettingsFromDb(db: Context['db']): Settings {
  const row = db.prepare("SELECT value FROM settings WHERE key = 'app_settings'").get() as
    | { value: string }
    | undefined

  if (!row) {
    return { ...DEFAULT_SETTINGS }
  }

  try {
    const parsed = JSON.parse(row.value)
    // Merge with defaults to ensure new fields are present
    return { ...DEFAULT_SETTINGS, ...parsed }
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

function saveSettingsToDb(db: Context['db'], settings: Settings): void {
  const json = JSON.stringify(settings)
  db.prepare(
    `INSERT INTO settings (key, value) VALUES ('app_settings', ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  ).run(json)
}

export const settingsRouter = router({
  get: publicProcedure.query(({ ctx }) => {
    return getSettingsFromDb(ctx.db)
  }),

  update: publicProcedure.input(settingsSchema.partial()).mutation(({ ctx, input }) => {
    const current = getSettingsFromDb(ctx.db)
    const updated: Settings = { ...current, ...input }
    saveSettingsToDb(ctx.db, updated)
    return updated
  }),
})
