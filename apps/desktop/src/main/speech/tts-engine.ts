import { randomUUID } from "node:crypto";
import { availableParallelism } from "node:os";
import { join } from "node:path";
import type { SpeechAudioEvent, SpeechEndEvent, VoiceModelEntry } from "@exegol/shared";
import { type UtilityProcess, utilityProcess, type WebContents } from "electron";
import { logger } from "../lib/logger";
import { MODELS_DIR, modelDir } from "../models/manager";
import { ttsSpec, voiceOf } from "./tts-config";
import type { TtsReply, TtsRequest } from "./tts-protocol";

/** Freed sooner than dictation: replies are read now and then; loaded, it holds ~500 MB */
const IDLE_MS = 3 * 60_000;
const RESPAWN_LIMIT = 3;

interface Utterance {
  id: string;
  sender: WebContents;
  startedAt: number;
  firstAudioMs: number | null;
  onGone: () => void;
}

let child: UtilityProcess | null = null;
let current: Utterance | null = null;
let idleTimer: ReturnType<typeof setTimeout> | null = null;
let crashes = 0;

function send(message: TtsRequest): void {
  child?.postMessage(message);
}

function toSender(u: Utterance, channel: string, payload: SpeechAudioEvent | SpeechEndEvent) {
  if (!u.sender.isDestroyed()) u.sender.send(channel, payload);
}

function end(u: Utterance, outcome: { error?: string; stopped?: boolean } = {}): void {
  if (current === u) current = null;
  u.sender.off("destroyed", u.onGone);
  toSender(u, "speech:end", { id: u.id, ...outcome });
  touch();
}

function onReply(msg: TtsReply): void {
  const u = current;
  if (!u || u.id !== msg.id) return;
  switch (msg.type) {
    case "audio":
      u.firstAudioMs ??= Date.now() - u.startedAt;
      toSender(u, "speech:audio", { id: u.id, samples: msg.samples, sampleRate: msg.sampleRate });
      return;
    case "done":
      crashes = 0;
      logger.info(
        `[Speech] read ${msg.sentences} sentence(s): first audio ${u.firstAudioMs ?? "-"}ms, load ${msg.loadMs}ms, synth ${msg.synthMs}ms`,
      );
      end(u);
      return;
    case "failed":
      if (msg.error !== "cancelled") logger.warn(`[Speech] synthesis failed: ${msg.error}`);
      end(u, { error: "The voice could not read this reply" });
      return;
  }
}

function spawn(): UtilityProcess {
  const proc = utilityProcess.fork(
    join(__dirname, "speech-engine.js"),
    [`--models-root=${MODELS_DIR}`],
    { serviceName: "Exegol Speech", stdio: "ignore" },
  );
  proc.on("message", (msg: TtsReply) => onReply(msg));
  proc.on("exit", (code) => {
    if (child !== proc) return;
    child = null;
    if (code !== 0) {
      crashes++;
      logger.warn(`[Speech] engine exited with code ${code}`);
    }
    if (current) end(current, { error: "The voice engine stopped" });
  });
  return proc;
}

function touch(): void {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    if (!current) stopSpeechEngine();
  }, IDLE_MS);
  idleTimer.unref?.();
}

/** Starts reading `sentences` for `sender`; any utterance playing stops first */
export function startUtterance(opts: {
  entry: VoiceModelEntry;
  voiceId: string;
  speed: number;
  sentences: string[];
  sender: WebContents;
}): string | null {
  if (crashes >= RESPAWN_LIMIT) return null;
  const voice = voiceOf(opts.entry, opts.voiceId);
  const threads = Math.max(1, Math.min(4, Math.floor(availableParallelism() / 2)));
  if (!voice) return null;
  const spec = ttsSpec(opts.entry, modelDir(opts.entry.id), voice, threads);
  stopUtterance();
  child ??= spawn();
  const id = randomUUID();
  const u: Utterance = {
    id,
    sender: opts.sender,
    startedAt: Date.now(),
    firstAudioMs: null,
    onGone: () => stopUtterance(id),
  };
  current = u;
  opts.sender.once("destroyed", u.onGone);
  send({
    type: "speak",
    id,
    spec,
    sid: voice.speakerId,
    speed: opts.speed,
    sentences: opts.sentences,
  });
  touch();
  return id;
}

/** Stops the given utterance, or whichever plays */
export function stopUtterance(id?: string): void {
  const u = current;
  if (!u || (id && u.id !== id)) return;
  send({ type: "cancel", id: u.id });
  end(u, { stopped: true });
}

/** Frees the model: the process (and its memory) goes away */
export function stopSpeechEngine(): void {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = null;
  stopUtterance();
  const proc = child;
  child = null;
  proc?.kill();
}
