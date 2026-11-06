import { homedir } from "node:os";
import { join } from "node:path";
import type { OlderChatPage, SessionTurn } from "@exegol/shared";
import Database from "libsql";
import { textTurn } from "./session-transcript";

const PAGE_ROWS = 80;

export const opencodeDbPath = () =>
  join(process.env.XDG_DATA_HOME ?? join(homedir(), ".local", "share"), "opencode", "opencode.db");

interface MessageRow {
  seq: number;
  type: string;
  time_created: number;
  data: string;
}

interface OpencodeData {
  text?: string;
  finish?: string | null;
  time?: { completed?: number | null };
  content?: { type?: string; text?: string; name?: string }[];
}

/** Text and tool names only. An assistant step still running ends the list: its row changes, so
 *  the cursor must not pass it */
export function opencodeTurns(rows: MessageRow[]): { turns: SessionTurn[]; last: number | null } {
  const turns: SessionTurn[] = [];
  let last: number | null = null;
  for (const row of rows) {
    const data = JSON.parse(row.data) as OpencodeData;
    const at = Math.floor(row.time_created / 1000);
    if (row.type === "assistant") {
      if (!data.time?.completed && !data.finish) break;
      for (const [i, block] of (data.content ?? []).entries()) {
        const id = `${row.seq}:${i}`;
        if (block.type === "text") turns.push(...textTurn(id, "assistant", block.text ?? "", at));
        if (block.type === "tool") turns.push(...textTurn(id, "tool", block.name ?? "", at));
      }
    } else {
      turns.push(...textTurn(String(row.seq), "user", data.text ?? "", at));
    }
    last = row.seq;
  }
  return { turns, last };
}

function withDb<T>(path: string, read: (db: Database.Database) => T): T {
  const db = new Database(path, { readonly: true, fileMustExist: true });
  try {
    return read(db);
  } finally {
    db.close();
  }
}

const TURN_ROWS = "seq, type, time_created, data FROM session_message";
const IN_SESSION = "session_id = ? AND type IN ('user', 'assistant')";

/** The newest top-level session of these folders touched since the agent started */
function latestSession(db: Database.Database, cwds: string[], sinceMs: number): string | null {
  const slots = cwds.map(() => "?").join(", ");
  const row = db
    .prepare(
      `SELECT id FROM session_v2
       WHERE directory IN (${slots}) AND parent_id IS NULL AND time_updated >= ?
       ORDER BY time_updated DESC LIMIT 1`,
    )
    .get(...cwds, sinceMs) as { id: string } | undefined;
  return row?.id ?? null;
}

const seqOf = (cursor: string | undefined, session: string): number | null => {
  const [id, seq] = (cursor ?? "").split(":");
  return id === session && seq ? Number(seq) : null;
};

/** From its own database; null when it has no session here, or a schema this does not know */
export function opencodePage(
  path: string,
  cwds: string[],
  sinceMs: number,
  cursor: string | undefined,
) {
  try {
    return withDb(path, (db) => {
      const session = latestSession(db, cwds, sinceMs);
      if (!session) return null;
      const after = seqOf(cursor, session);
      const rows = (
        after !== null
          ? db
              .prepare(`SELECT ${TURN_ROWS} WHERE ${IN_SESSION} AND seq > ? ORDER BY seq LIMIT ?`)
              .all(session, after, PAGE_ROWS)
          : db
              .prepare(`SELECT ${TURN_ROWS} WHERE ${IN_SESSION} ORDER BY seq DESC LIMIT ?`)
              .all(session, PAGE_ROWS)
              .reverse()
      ) as MessageRow[];
      const { turns, last } = opencodeTurns(rows);
      const first = rows[0]?.seq;
      return {
        turns,
        cursor: `${session}:${last ?? after ?? 0}`,
        reset: after === null,
        older: after === null && rows.length === PAGE_ROWS ? `${session}:${first}` : null,
      };
    });
  } catch {
    return null;
  }
}

export function olderOpencodePage(path: string, before: string): OlderChatPage {
  const [session, seq] = before.split(":");
  try {
    return withDb(path, (db) => {
      const rows = db
        .prepare(`SELECT ${TURN_ROWS} WHERE ${IN_SESSION} AND seq < ? ORDER BY seq DESC LIMIT ?`)
        .all(session, Number(seq), PAGE_ROWS)
        .reverse() as MessageRow[];
      const more = rows.length === PAGE_ROWS;
      return {
        turns: opencodeTurns(rows).turns,
        older: more ? `${session}:${rows[0]?.seq}` : null,
      };
    });
  } catch {
    return { turns: [], older: null };
  }
}
