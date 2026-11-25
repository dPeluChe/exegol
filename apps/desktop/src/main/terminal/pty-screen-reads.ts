import type { LiveSnapshot, ScreenDialog } from "@exegol/shared";
import type { HeadlessEmulator } from "./headless-emulator";
import type { Session } from "./pty-session-types";
import { awaitsConfirm, readScreenDialog } from "./screen-dialog";

/** A snapshot waits at most this long for queued output to parse, then goes without a seq */
const SNAPSHOT_PARSE_DEADLINE_MS = 1_500;

const MAX_CHAT_LINES = 600;

/** The screen holding exactly the output up to `seq`, serialized once that output is parsed */
export function parsedLiveSnapshot(
  sessions: Map<string, Session>,
  id: string,
): Promise<LiveSnapshot | null> {
  const s = sessions.get(id);
  if (!s) return Promise.resolve(null);
  const { emulator } = s;
  const seq = s.lastSeq;
  return emulator.afterParsed(SNAPSHOT_PARSE_DEADLINE_MS, (parsed) => {
    if (sessions.get(id) !== s) return null;
    // A Retry resync may have swapped the model meanwhile: its screen is not the one `seq` names
    const model = s.emulator;
    const snapshot = model.snapshot();
    return {
      data: snapshot ? snapshot + model.modeSequence() : null,
      seq: parsed && model === emulator ? seq : undefined,
      alt: model.alternateScreen,
      ...model.size,
    };
  });
}

/** The numbered dialog the session's screen shows now, if any */
export function screenDialog(sessions: Map<string, Session>, id: string): ScreenDialog | null {
  const lines = sessions.get(id)?.emulator.visibleLines();
  return lines ? readScreenDialog(lines) : null;
}

/** A gate with no numbers on screen (a trust prompt): only its terminal answers it */
export function screenGate(sessions: Map<string, Session>, id: string): boolean {
  const lines = sessions.get(id)?.emulator.visibleLines();
  return !!lines && readScreenDialog(lines) == null && awaitsConfirm(lines);
}

/** A dialog or a gate on screen: an Enter typed now would answer it */
export function holdsEnter(sessions: Map<string, Session>, id: string): boolean {
  const lines = sessions.get(id)?.emulator.visibleLines();
  return !!lines && (readScreenDialog(lines) != null || awaitsConfirm(lines));
}

/** The chat of a CLI with no transcript */
export function textLines(
  sessions: Map<string, Session>,
  id: string,
): ReturnType<HeadlessEmulator["textLines"]> | null {
  return sessions.get(id)?.emulator.textLines(MAX_CHAT_LINES) ?? null;
}
