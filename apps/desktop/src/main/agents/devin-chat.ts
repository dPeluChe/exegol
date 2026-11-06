import { join } from "node:path";
import type { OlderChatPage, SessionTurn } from "@exegol/shared";
import type Database from "libsql";
import { z } from "zod";
import { parseJson } from "../lib/parse-json";
import { withReadonlyDb } from "../lib/readonly-db";
import { windowsAppData, xdgDataDir } from "../lib/xdg-data";
import { textTurn } from "./session-transcript";

const PAGE_NODES = 80;

export const devinDbPath = () =>
  join(
    process.platform === "win32" ? windowsAppData() : xdgDataDir(),
    "devin",
    "cli",
    "sessions.db",
  );

export interface DevinNode {
  node_id: number;
  created_at: number;
  chat_message: string;
}

const DevinMessage = z
  .object({
    role: z.string().nullish(),
    content: z.string().nullish(),
    tool_calls: z.array(z.object({ name: z.string().nullish() }).passthrough()).nullish(),
    metadata: z.object({ is_user_input: z.boolean().nullish() }).passthrough().nullish(),
  })
  .passthrough();

/** Text and tool names only. A user row nobody typed (a resume, a reminder) has no is_user_input.
 *  A row of another shape is skipped */
export function devinTurns(nodes: DevinNode[]): SessionTurn[] {
  return nodes.flatMap((node) => {
    const m = parseJson(node.chat_message, DevinMessage);
    if (!m) return [];
    const id = String(node.node_id);
    if (m.role === "user" && m.metadata?.is_user_input) {
      return textTurn(id, "user", m.content ?? "", node.created_at);
    }
    if (m.role !== "assistant") return [];
    return [
      ...textTurn(id, "assistant", m.content ?? "", node.created_at),
      ...(m.tool_calls ?? []).flatMap((call, i) =>
        textTurn(`${id}:${i}`, "tool", call.name ?? "", node.created_at),
      ),
    ];
  });
}

export interface DevinTarget {
  /** Named by its resume command, once it has one */
  id: string | null;
  /** Else the newest in these folders touched since `sinceSec` */
  cwds: string[];
  sinceSec: number;
}

interface SessionRow {
  id: string;
  main_chain_id: number | null;
}

function findSession(db: Database.Database, target: DevinTarget): SessionRow | null {
  const columns = "SELECT id, main_chain_id FROM sessions";
  if (target.id) {
    return (db.prepare(`${columns} WHERE id = ?`).get(target.id) as SessionRow) ?? null;
  }
  if (target.cwds.length === 0) return null;
  const slots = target.cwds.map(() => "?").join(", ");
  const row = db
    .prepare(
      `${columns} WHERE working_directory IN (${slots}) AND hidden = 0 AND last_activity_at >= ?
       ORDER BY last_activity_at DESC LIMIT 1`,
    )
    .get(...target.cwds, target.sinceSec) as SessionRow | undefined;
  return row ?? null;
}

interface Link {
  id: number;
  parent: number | null;
}

/** Newest first. Nodes form a tree (retries, subagents, rewinds): the session is the head's chain */
function chainFrom(db: Database.Database, session: string, head: number): Link[] {
  return db
    .prepare(
      `WITH RECURSIVE chain(id, parent) AS (
         SELECT node_id, parent_node_id FROM message_nodes WHERE session_id = ? AND node_id = ?
         UNION ALL
         SELECT m.node_id, m.parent_node_id FROM message_nodes m
         JOIN chain ON m.session_id = ? AND m.node_id = chain.parent
         LIMIT ?
       ) SELECT id, parent FROM chain`,
    )
    .all(session, head, session, PAGE_NODES) as Link[];
}

// Tool rows hold whole file reads: never loaded
function nodesOf(db: Database.Database, session: string, links: Link[]): DevinNode[] {
  if (links.length === 0) return [];
  const slots = links.map(() => "?").join(", ");
  return db
    .prepare(
      `SELECT node_id, created_at, chat_message FROM message_nodes
       WHERE session_id = ? AND node_id IN (${slots})
         AND json_extract(chat_message, '$.role') IN ('user', 'assistant')
       ORDER BY node_id`,
    )
    .all(session, ...links.map((l) => l.id)) as DevinNode[];
}

const olderMark = (session: string, links: Link[]) => {
  const parent = links.at(-1)?.parent;
  return links.length === PAGE_NODES && parent != null ? `${session}:${parent}` : null;
};

/** From its own database; null when it has no session here, or a schema this does not know */
export function devinPage(path: string, target: DevinTarget, cursor: string | undefined) {
  try {
    return withReadonlyDb(path, (db) => {
      const session = findSession(db, target);
      if (!session?.main_chain_id) return null;
      const head = session.main_chain_id;
      const [cursorSession, seen] = (cursor ?? "").split(":");
      const after = cursorSession === session.id && seen ? Number(seen) : null;
      const page = { cursor: `${session.id}:${head}`, older: null };
      if (after === head) return { ...page, turns: [], reset: false };
      const links = chainFrom(db, session.id, head);
      const known = links.findIndex((l) => l.id === after);
      if (known >= 0) {
        const turns = devinTurns(nodesOf(db, session.id, links.slice(0, known)));
        return { ...page, turns, reset: false };
      }
      // First read, or a rewind took the last node seen out of the chain
      return {
        ...page,
        turns: devinTurns(nodesOf(db, session.id, links)),
        reset: true,
        older: olderMark(session.id, links),
      };
    });
  } catch {
    return null;
  }
}

export function olderDevinPage(path: string, before: string): OlderChatPage {
  const [session, node] = before.split(":");
  if (!session || !node) return { turns: [], older: null };
  try {
    return withReadonlyDb(path, (db) => {
      const links = chainFrom(db, session, Number(node));
      return {
        turns: devinTurns(nodesOf(db, session, links)),
        older: olderMark(session, links),
      };
    });
  } catch {
    return { turns: [], older: null };
  }
}
