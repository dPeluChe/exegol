import type { Migration } from "../migrations";

/**
 * Wave 2 — WT-D (Product Surface & Health) migrations. Owned by feat/wtd-surface.
 * Id prefix `w2d_` — never edit another group's set file.
 */
export const wave2SurfaceMigrations: Migration[] = [
  {
    id: "w2d_001_budgets",
    sql: `CREATE TABLE IF NOT EXISTS budgets (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      period TEXT NOT NULL CHECK (period IN ('daily', 'weekly')),
      limit_type TEXT NOT NULL CHECK (limit_type IN ('tokens', 'dollars')),
      limit_value REAL NOT NULL,
      hard_stop INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_budgets_project_period ON budgets(project_id, period);

    CREATE TABLE IF NOT EXISTS budget_alerts (
      id TEXT PRIMARY KEY,
      budget_id TEXT NOT NULL,
      threshold INTEGER NOT NULL CHECK (threshold IN (80, 100)),
      period_key TEXT NOT NULL,
      fired_at INTEGER NOT NULL DEFAULT (unixepoch()),
      FOREIGN KEY (budget_id) REFERENCES budgets(id) ON DELETE CASCADE
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_budget_alerts_unique ON budget_alerts(budget_id, threshold, period_key)`,
  },
];
