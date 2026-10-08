/**
 * The pane that owns a session already answers terminal queries, so a mirror forwarding its own
 * copy would type every reply into the agent a second time, and replay old queries from the
 * snapshot on mount. Mirrors drop them (`stripTerminalReports`) and keep only what the user typed.
 */
export { stripTerminalReports } from "@exegol/shared";
