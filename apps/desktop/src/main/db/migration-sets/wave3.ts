import type { Migration } from "../migrations";

/**
 * Wave 3 migrations (T156+). Id prefix `w3_`.
 */
export const wave3Migrations: Migration[] = [
  {
    // T160: user-editable session alias — addressing name for inter-agent
    // messaging (agent_send by name) and UI labels.
    id: "w3_001_agent_alias",
    sql: "ALTER TABLE agents ADD COLUMN alias TEXT;",
  },
];
