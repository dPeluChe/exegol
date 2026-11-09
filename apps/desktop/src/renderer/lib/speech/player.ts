import type { SpeakResult, SpeechAudioEvent, SpeechEndEvent } from "@exegol/shared";
import { useSyncExternalStore } from "react";
import { useToastStore } from "../../stores/toasts";

/** What plays: `key` names the reply (a chat turn id), `id` the main process utterance */
interface Playing {
  key: string;
  id: string | null;
}

let playing: Playing | null = null;
let ctx: AudioContext | null = null;
let sources: AudioBufferSourceNode[] = [];
let nextAt = 0;
let mainDone = false;
let early: SpeechAudioEvent[] = [];
let listening = false;
const subscribers = new Set<() => void>();

function emit(): void {
  for (const fn of subscribers) fn();
}

function silence(): void {
  for (const s of sources) {
    s.onended = null;
    try {
      s.stop();
    } catch {}
  }
  sources = [];
  early = [];
  nextAt = 0;
  mainDone = false;
}

function finish(): void {
  silence();
  playing = null;
  emit();
}

function enqueue(event: SpeechAudioEvent): void {
  ctx ??= new AudioContext();
  void ctx.resume();
  const buffer = ctx.createBuffer(1, event.samples.length, event.sampleRate);
  buffer.copyToChannel(new Float32Array(event.samples), 0);
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  source.connect(ctx.destination);
  const at = Math.max(ctx.currentTime + 0.05, nextAt);
  source.start(at);
  nextAt = at + buffer.duration;
  sources.push(source);
  source.onended = () => {
    sources = sources.filter((s) => s !== source);
    if (mainDone && sources.length === 0) finish();
  };
}

function onAudio(event: SpeechAudioEvent): void {
  if (!playing) return;
  if (playing.id === null) early.push(event);
  else if (event.id === playing.id) enqueue(event);
}

function onEnd(event: SpeechEndEvent): void {
  if (!playing || playing.id !== event.id) return;
  if (event.error || event.stopped) {
    if (event.error) useToastStore.getState().addToast({ type: "warning", title: event.error });
    finish();
    return;
  }
  mainDone = true;
  if (sources.length === 0) finish();
}

function listen(): void {
  if (listening || !window.api?.speech) return;
  listening = true;
  window.api.speech.onAudio(onAudio);
  window.api.speech.onEnd(onEnd);
  window.addEventListener("pagehide", () => stopSpeaking());
}

/** Reads a reply aloud; whatever plays stops first. Resolves once main took it or skipped it */
export async function speakReply(
  key: string,
  text: string,
  agentId: string,
  auto = false,
): Promise<SpeakResult> {
  listen();
  stopSpeaking();
  const mine: Playing = { key, id: null };
  playing = mine;
  emit();
  const result: SpeakResult = await window.api.speech
    .speak({ text, agentId, auto })
    .catch(() => ({ skipped: "empty" as const }));
  if (playing !== mine) {
    if ("id" in result) void window.api.speech.stop(result.id);
    return result;
  }
  if ("skipped" in result) {
    finish();
    return result;
  }
  mine.id = result.id;
  const held = early.filter((e) => e.id === result.id);
  early = [];
  for (const event of held) enqueue(event);
  return result;
}

export function stopSpeaking(): void {
  const was = playing;
  if (!was) return;
  finish();
  if (was.id) void window.api.speech.stop(was.id);
}

function subscribe(fn: () => void): () => void {
  subscribers.add(fn);
  return () => subscribers.delete(fn);
}

/** The reply key being read, null when silent */
export function useSpeaking(): string | null {
  return useSyncExternalStore(subscribe, () => playing?.key ?? null);
}
