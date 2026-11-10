/** Replies the Commander ended while its chat was not in view */
export interface CommanderUnread {
  count: number;
  /** Unix seconds: the start of the first turn not read, to mark where they begin in the chat */
  since: number | null;
}

export const NO_COMMANDER_UNREAD: CommanderUnread = { count: 0, since: null };
