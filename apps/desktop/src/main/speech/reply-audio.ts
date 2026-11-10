import { speechSentences } from "@exegol/shared";
import { commanderVoice } from "../commander/home";
import { getDb } from "../db/client";
import { modelStatus } from "../models/manager";
import { VOICE_CATALOG } from "../models/voice-catalog";
import { prepareUtterance } from "./tts-engine";

/** A reply the Commander just finished: its audio is made now, so Speak (or its call) plays at
 *  once. Only with a voice installed; the text is never logged */
export async function prepareReplyAudio(text: string): Promise<void> {
  const sentences = speechSentences(text);
  const entry = VOICE_CATALOG[0];
  if (sentences.length === 0 || !entry) return;
  if ((await modelStatus(entry)).state !== "ready") return;
  const settings = commanderVoice(getDb());
  prepareUtterance({ entry, voiceId: settings.voice, speed: settings.speed, sentences });
}
