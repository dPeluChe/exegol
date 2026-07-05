import type { Migration } from "../migrations";

/**
 * Wave 2 — WT-B (Memory, Knowledge & Skills) migrations. Owned by feat/wtb-knowledge.
 * Id prefix `w2b_` — never edit another group's set file.
 */
export const wave2KnowledgeMigrations: Migration[] = [
  {
    id: "w2b_001_memory_salience_v2",
    sql: `
      ALTER TABLE memories ADD COLUMN reinforcement_count INTEGER NOT NULL DEFAULT 1;
      ALTER TABLE memories ADD COLUMN last_reinforced_at INTEGER;
      ALTER TABLE memories ADD COLUMN superseded_by TEXT;

      UPDATE memories SET last_reinforced_at = created_at WHERE last_reinforced_at IS NULL;

      CREATE INDEX IF NOT EXISTS idx_memories_superseded_by ON memories(superseded_by);
    `,
  },
];
