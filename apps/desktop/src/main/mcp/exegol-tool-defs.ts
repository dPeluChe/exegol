import {
  BROWSER_READ_TOOLS,
  BROWSER_TOOL_DEFS,
  BROWSER_WRITE_TOOLS,
  type ExegolToolDef,
  type ToolBody,
} from "./browser-tool-defs";
import {
  COMMANDER_TOOL_DEFS,
  COMMANDER_TOOLS,
  isCommanderTool,
  PROJECT_ARG,
} from "./commander-tool-defs";
import { INBOX_TOOL_DEFS, INBOX_TOOLS, isInboxTool } from "./inbox-tool-defs";
import { isNotesTool, NOTES_TOOL_DEFS, NOTES_TOOLS } from "./notes-tool-defs";

export type ExegolAccessMode = "read" | "plan" | "write";

export const EXEGOL_TOOL_NAMES = [
  "agents_list",
  "agent_send",
  "message_status",
  "message_cancel",
  "messages_check",
  "agent_link",
  "claim_paths",
  "release_paths",
  "list_claims",
  ...INBOX_TOOLS,
  ...NOTES_TOOLS,
  ...COMMANDER_TOOLS,
  ...BROWSER_READ_TOOLS,
  ...BROWSER_WRITE_TOOLS,
] as const;
export type ExegolToolName = (typeof EXEGOL_TOOL_NAMES)[number];

/** Tools a read/plan agent may still call — everything else needs write access.
 *  Messaging (T157) is not a repo write: read/plan agents may coordinate too. */
export const NON_WRITE_TOOLS = new Set<ExegolToolName>([
  "agents_list",
  "agent_send",
  "message_status",
  "message_cancel",
  "messages_check",
  "agent_link",
  // Claims are coordination, not repo writes: a read/plan agent must be able to
  // reserve the files it is about to report on.
  "claim_paths",
  "release_paths",
  "list_claims",
  // Coordination too: a thread or a note changes nothing in the repo
  ...INBOX_TOOLS,
  ...NOTES_TOOLS,
  // The Commander's own: its session is the only caller they answer
  ...COMMANDER_TOOLS,
  ...BROWSER_READ_TOOLS,
]);

const OWN_TOOLS: ToolBody<ExegolToolName>[] = [
  ...INBOX_TOOL_DEFS,
  ...NOTES_TOOL_DEFS,
  ...COMMANDER_TOOL_DEFS,
  {
    name: "agents_list",
    title: "List agents",
    description:
      "List the live agents you can message: those of your project, or every project with " +
      "all_projects. The response ALWAYS has both keys: `self` (YOUR session id + name — sign " +
      "with it; `name` may be null) and `agents` (the others: id, name, provider, project, " +
      "status, task; may be an empty array); `inOtherProjects` counts the ones left out. Plain " +
      "terminals are not listed: they cannot read messages. Ids and names are stable for the " +
      "whole session — cache them. Address agent_send by name when set, or by id.",
    inputSchema: {
      type: "object",
      properties: {
        all_projects: { type: "boolean", description: "Default false: only your project" },
      },
    },
  },
  {
    name: "agent_send",
    title: "Message an agent",
    description:
      "Send a text message to another live agent, addressed by session name (alias) or " +
      "id. Exegol delivers it at the target's next turn boundary (never mid-generation) " +
      "with your identity attached — the target knows it came from an agent, not the " +
      "user. Set expects_reply=false on closing messages so the exchange can END instead " +
      "of ping-ponging forever. Pass message_id (any unique string you make up) so that " +
      "retrying after a timeout can never deliver the same message twice. Returns " +
      "{messageId, status: delivered|queued_for_next_turn_boundary, duplicate?}.",
    inputSchema: {
      type: "object",
      properties: {
        target: {
          type: "string",
          description: "Session name (alias) or agent id from agents_list",
        },
        message: { type: "string", maxLength: 12_000, description: "Plain text" },
        expects_reply: {
          type: "boolean",
          description:
            "Default true: tells the receiver you await their reply. Use false for FYI/closing messages.",
        },
        message_id: {
          type: "string",
          description:
            "Idempotency key you generate. If a call times out, retry with the SAME value: " +
            "Exegol returns the original result (duplicate:true) instead of sending again.",
        },
        in_reply_to: {
          type: "string",
          description:
            "Id of the Exegol message you are answering (shown in its header) — threads the exchange.",
        },
      },
      required: ["target", "message"],
    },
  },
  {
    name: "message_status",
    title: "Check a message",
    description:
      "Check what happened to a message you sent (or received) when a call timed out and " +
      "you can't tell whether it went through. Returns state: delivered | queued " +
      "(with queuePosition, and held_by when something on the target's side keeps it waiting) | " +
      "undeliverable (the target's session ended) | unknown.",
    inputSchema: {
      type: "object",
      properties: {
        message_id: { type: "string", description: "The messageId returned by agent_send" },
      },
      required: ["message_id"],
    },
  },
  {
    name: "message_cancel",
    title: "Cancel a message",
    description:
      "Withdraw a message you sent that has NOT been delivered yet (still queued for the " +
      "target's next turn boundary). Use it when an assignment turns out to be wrong instead " +
      "of sending a correction and hoping both are read in order. Fails if it already landed.",
    inputSchema: {
      type: "object",
      properties: {
        message_id: { type: "string", description: "The messageId returned by agent_send" },
      },
      required: ["message_id"],
    },
  },
  {
    name: "messages_check",
    title: "Check for messages",
    description:
      "Fetch the full body of messages too long to paste into your terminal. When another " +
      "agent sends you something large, Exegol delivers a one-line pointer and holds the body " +
      "here — call this to read it. Reading DRAINS them, so process what you get; the sender " +
      "sees the message as consumed once you do.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "claim_paths",
    title: "Claim files",
    description:
      "Reserve files or directories before editing them, so two agents never write the same " +
      "file — ENFORCED for sessions Exegol can intercept (their file-editing tools are " +
      "blocked), advisory for the rest; the response says which is which. Writes made " +
      "through shell commands are never intercepted. ALL-OR-NOTHING: if any path overlaps another live agent's claim, nothing is " +
      "granted and you get the conflicts (who holds what) — pick different files or negotiate " +
      "via agent_send. A directory claim covers everything under it. Re-claiming what you " +
      "already hold succeeds. Paths may be relative to your working directory. Your claims are " +
      "released automatically when your session ends.",
    inputSchema: {
      type: "object",
      properties: {
        paths: {
          type: "array",
          items: { type: "string" },
          description: "Files or directories, e.g. ['src/auth/login.ts', 'convex/']",
        },
        note: {
          type: "string",
          description: "Why you need them — shown to an agent that hits the conflict",
        },
      },
      required: ["paths"],
    },
  },
  {
    name: "release_paths",
    title: "Release files",
    description:
      "Give back path claims once you are done, so another agent can take them. Omit `paths` " +
      "to release everything you hold.",
    inputSchema: {
      type: "object",
      properties: { paths: { type: "array", items: { type: "string" } } },
    },
  },
  {
    name: "list_claims",
    title: "List file claims",
    description:
      "Who currently holds which paths in this project. Call it BEFORE handing out work: it " +
      "turns 'hope nobody else is in this file' into a fact.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "agent_link",
    title: "Link to an agent",
    description:
      "Register an Exegol-ENFORCED link: when YOUR current turn ends, Exegol automatically " +
      "notifies the target agent (with your identity attached) — use this for 'when I " +
      "finish, tell X' so the notification happens even if you forget. Roles: notify " +
      "(FYI), reviewer (target reviews your work), feedback. One-shot by default.",
    inputSchema: {
      type: "object",
      properties: {
        target: { type: "string", description: "Session name (alias) or agent id" },
        role: { type: "string", enum: ["notify", "reviewer", "feedback"] },
        note: { type: "string", description: "Context included in the notification" },
        once: {
          type: "boolean",
          description:
            "Default true (fire on your next turn end, then expire). false = every turn.",
        },
      },
      required: ["target"],
    },
  },
];

// Narrower than NON_WRITE_TOOLS: those change no repo files, these change nothing at all
const READ_ONLY = new Set<ExegolToolName>([
  "agents_list",
  "message_status",
  "list_claims",
  "inbox_list",
  "note_list",
  "note_read",
  "note_search",
]);

export const EXEGOL_TOOL_DEFS: ExegolToolDef<ExegolToolName>[] = [
  ...OWN_TOOLS.map((t) => ({
    ...t,
    annotations: {
      readOnlyHint: READ_ONLY.has(t.name),
      destructiveHint: false,
      openWorldHint: false,
    },
  })),
  ...BROWSER_TOOL_DEFS,
];

/** Tool defs visible at the given access mode (display-only in the shim: the server re-derives
 *  the mode from the DB and enforces it on every call, browser_eval's project setting included) */
export function getToolDefsForAccessMode(
  accessMode: ExegolAccessMode,
  browserEval = true,
  commander = false,
): ExegolToolDef<ExegolToolName>[] {
  const tools = EXEGOL_TOOL_DEFS.filter(
    (t) =>
      (browserEval || t.name !== "browser_eval") &&
      (commander || !isCommanderTool(t.name)) &&
      (accessMode === "write" || NON_WRITE_TOOLS.has(t.name)),
  );
  return commander ? tools.map(withProjectArg) : tools;
}

/** The Commander's inbox and note tools take the project they act in */
function withProjectArg(tool: ExegolToolDef<ExegolToolName>): ExegolToolDef<ExegolToolName> {
  if (!isInboxTool(tool.name) && !isNotesTool(tool.name)) return tool;
  const schema = tool.inputSchema as { properties?: Record<string, unknown> };
  return {
    ...tool,
    inputSchema: { ...schema, properties: { ...schema.properties, project: PROJECT_ARG } },
  };
}
