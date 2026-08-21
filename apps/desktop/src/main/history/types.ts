/**
 * T181 — a session Exegol did NOT launch, read from the CLI's own local store.
 *
 * Every agent CLI keeps its own history on disk, scoped by working directory.
 * Exegol only ever knew about the sessions it started itself, so the answer to
 * "what has been done on this repo" was missing everything the user ran in a
 * plain terminal — which, for a tool whose whole job is orchestrating those
 * CLIs, is most of the truth (Antonio, 2026-08-18).
 */
export interface LocalSession {
  /** Provider id, matching the registry (`claude-code`, `codex`, `opencode`). */
  provider: string;
  /** The provider's own session id — also what its resume flag takes. */
  sessionId: string;
  title: string | null;
  cwd: string;
  branch: string | null;
  startedAt: number | null;
  endedAt: number | null;
  /** Provider CLI version that wrote it, when the store records one. */
  version: string | null;
  /** Bytes on disk — the only cheap proxy for "how much happened". */
  sizeBytes: number;
}

export interface LocalHistoryProvider {
  id: string;
  /**
   * @param cwds Absolute paths that count as "this repo" — the checkout plus
   *   every worktree Exegol cut from it, since an isolated agent's cwd is not
   *   the project path.
   * @param since Epoch seconds; older sessions are skipped without being read.
   */
  list(cwds: string[], since: number): Promise<LocalSession[]>;
}

/**
 * One spelling for a session title, whatever store it came from.
 *
 * Five adapters each had their own `.replace(/\s+/g," ").trim().slice(0,120)`
 * — and claude-code capped without collapsing while droid did neither, so the
 * same list rendered multi-line prompts next to normalized ones.
 */
export function normalizeTitle(text: string | null | undefined): string | null {
  const clean = text?.replace(/\s+/g, " ").trim();
  return clean ? clean.slice(0, TITLE_MAX_CHARS) : null;
}

const TITLE_MAX_CHARS = 120;
