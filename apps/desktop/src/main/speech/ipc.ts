import { type SpeakResult, speechSentences } from "@exegol/shared";
import { ipcMain, type WebContents } from "electron";
import { z } from "zod";
import { commanderVoice } from "../commander/home";
import { getDb } from "../db/client";
import { modelStatus } from "../models/manager";
import { VOICE_CATALOG } from "../models/voice-catalog";
import { floatingChatOf } from "../windows/floating";
import { noteReading } from "./reading";
import { noteSpokenWith } from "./spoken-with";
import { startUtterance, stopUtterance } from "./tts-engine";

const speakInput = z.object({
  text: z.string().max(200_000),
  agentId: z.string().min(1).max(200),
  auto: z.boolean().optional(),
});

async function speak(sender: WebContents, raw: unknown): Promise<SpeakResult> {
  const input = speakInput.parse(raw);
  const settings = commanderVoice(getDb());
  if (input.auto) {
    if (!settings.auto) return { skipped: "off" };
    // The floating chat, when open, is the one that reads new replies
    const floating = floatingChatOf(input.agentId);
    if (floating && floating !== sender) return { skipped: "other-window" };
  }
  const sentences = speechSentences(input.text);
  if (sentences.length === 0) return { skipped: "empty" };
  const entry = VOICE_CATALOG[0];
  if (!entry || (await modelStatus(entry)).state !== "ready") return { skipped: "no-model" };
  const id = startUtterance({
    entry,
    voiceId: settings.voice,
    speed: settings.speed,
    sentences,
    sender,
  });
  if (!id) return { skipped: "no-model" };
  noteSpokenWith(sentences, { voice: settings.voice, speed: settings.speed, model: entry.id });
  return { id };
}

const watched = new Set<number>();

/** IPC, not tRPC: the audio goes back only to the window that asked */
export function registerSpeechIpc(): void {
  ipcMain.handle("speech:speak", (event, input) => speak(event.sender, input));
  ipcMain.handle("speech:stop", (_event, id: unknown) => {
    stopUtterance(typeof id === "string" ? id : undefined);
  });
  ipcMain.handle("speech:reading", (event, on: unknown) => {
    const { sender } = event;
    const id = sender.id;
    if (!watched.has(id)) {
      watched.add(id);
      sender.once("destroyed", () => {
        watched.delete(id);
        noteReading(id, false);
      });
    }
    noteReading(id, on === true);
  });
}
