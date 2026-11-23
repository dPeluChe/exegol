import type { ColabNews } from "../db/queries/inbox";

/** The person wrote to the session this recently: they are working with it, the notice waits */
export const PERSON_AWAY_MS = 10 * 60_000;
/** A session is told at most this often, however many messages arrive */
export const NOTICE_GAP_MS = 5 * 60_000;
/** Agent messages in a row after which a thread wakes nobody (it still takes replies) */
export const NOTICE_AGENT_TURNS = 6;

export interface NoticeSession {
  id: string;
  projectId: string;
  alias?: string | null;
}

/** Who hears of each thread: the session it is for while one of that name is live, else the
 *  project's main session. News with no live session waits for one */
export function noticeTargets(
  news: readonly ColabNews[],
  sessions: readonly NoticeSession[],
  mainOf: (projectId: string) => string | undefined,
): Map<string, ColabNews[]> {
  const out = new Map<string, ColabNews[]>();
  for (const n of news) {
    const name = n.toSession?.toLowerCase();
    const named = name
      ? sessions.find((s) => s.projectId === n.projectId && s.alias?.toLowerCase() === name)
      : undefined;
    const id = named?.id ?? mainOf(n.projectId);
    if (!id) continue;
    const list = out.get(id);
    if (list) list.push(n);
    else out.set(id, [n]);
  }
  return out;
}

export interface NoticeState {
  atPrompt: boolean;
  quiet: boolean;
  /** Since the person last wrote to it, null for never in this run of the app */
  personMs: number | null;
  /** Since it was last told */
  toldMs: number | null;
}

export function mayNotice(s: NoticeState): boolean {
  if (!s.atPrompt || s.quiet) return false;
  if (s.personMs !== null && s.personMs < PERSON_AWAY_MS) return false;
  return s.toldMs === null || s.toldMs >= NOTICE_GAP_MS;
}

/** Counts and colab names only: a thread's words reach a session when it reads the thread */
export function noticeText(news: readonly ColabNews[]): string {
  const byColab = new Map<string, number>();
  for (const n of news) byColab.set(n.colab, (byColab.get(n.colab) ?? 0) + 1);
  const where = [...byColab]
    .map(
      ([colab, n]) =>
        `${n} thread${n === 1 ? "" : "s"} with news in the colab ${JSON.stringify(colab)}`,
    )
    .join(", ");
  return `Exegol inbox: ${where}. Review with inbox_list when you are free or your current work is done. Keep your conversation's language.`;
}
