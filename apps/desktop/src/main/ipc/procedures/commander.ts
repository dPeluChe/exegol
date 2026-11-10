import { SPEECH_SPEED_MAX, SPEECH_SPEED_MIN, speechSentences } from "@exegol/shared";
import { z } from "zod";
import {
  commanderAutonomy,
  commanderFeed,
  commanderProjectId,
  commanderVoice,
  ensureCommanderHome,
  setCommanderAutonomy,
  setCommanderFeed,
  setCommanderVoice,
} from "../../commander/home";
import { listAgents } from "../../db/queries/agents";
import { listCommanderLog } from "../../db/queries/commander-log";
import {
  deleteSpeechFeedback,
  listSpeechFeedback,
  saveSpeechFeedback,
  speechFeedbackFor,
} from "../../db/queries/speech-feedback";
import { listVoiceModels } from "../../models/manager";
import { VOICE_CATALOG } from "../../models/voice-catalog";
import { spokenWith } from "../../speech/spoken-with";
import { publicProcedure, router } from "../trpc";

const turnId = z.string().min(1).max(200);

export const commanderRouter = router({
  /** Its project once started, its newest session (live or ended, to resume) and how it answers */
  state: publicProcedure.query(({ ctx }) => {
    const projectId = commanderProjectId(ctx.db);
    const sessions = projectId
      ? listAgents(ctx.db, projectId).filter((a) => a.cliType !== "shell")
      : [];
    return {
      projectId,
      last: sessions[0] ?? null,
      autonomy: commanderAutonomy(ctx.db),
      feed: commanderFeed(ctx.db),
    };
  }),

  /** The folder with its brief and its project row, before a session starts in it */
  prepare: publicProcedure.mutation(async ({ ctx }) => {
    const project = await ensureCommanderHome(ctx.db);
    return { projectId: project.id };
  }),

  setAutonomy: publicProcedure
    .input(z.object({ autonomy: z.enum(["answer", "ask"]) }))
    .mutation(({ ctx, input }) => {
      setCommanderAutonomy(ctx.db, input.autonomy);
      return { autonomy: input.autonomy };
    }),

  setFeed: publicProcedure.input(z.object({ on: z.boolean() })).mutation(({ ctx, input }) => {
    setCommanderFeed(ctx.db, input.on);
    return { feed: input.on };
  }),

  /** How its replies are read aloud, the voices offered and whether a voice model is installed */
  voice: publicProcedure.query(async ({ ctx }) => {
    const model = (await listVoiceModels())[0];
    return {
      settings: commanderVoice(ctx.db),
      voices: model?.voices ?? [],
      ready: model?.status.state === "ready",
    };
  }),

  setVoice: publicProcedure
    .input(
      z.object({
        auto: z.boolean().optional(),
        voice: z
          .string()
          .regex(/^[a-z]{2}_[a-z]+$/)
          .optional(),
        speed: z.number().min(SPEECH_SPEED_MIN).max(SPEECH_SPEED_MAX).optional(),
      }),
    )
    .mutation(({ ctx, input }) => setCommanderVoice(ctx.db, input)),

  /** What the Commander did, newest first */
  history: publicProcedure.query(({ ctx }) => listCommanderLog(ctx.db, 100)),

  /** The person's marks on how these replies were read aloud */
  voiceFeedback: publicProcedure
    .input(z.object({ agentId: z.string().min(1).max(200) }))
    .query(({ ctx, input }) => speechFeedbackFor(ctx.db, input.agentId)),

  /** The spoken text is rebuilt here from the reply, as the engine gets it */
  rateVoice: publicProcedure
    .input(
      z.object({
        agentId: z.string().min(1).max(200),
        turnId,
        text: z.string().max(200_000),
        rating: z.enum(["good", "bad"]),
        note: z.string().max(500).optional(),
      }),
    )
    .mutation(({ ctx, input }) => {
      const sentences = speechSentences(input.text);
      const settings = commanderVoice(ctx.db);
      const how = spokenWith(sentences) ?? {
        voice: settings.voice,
        speed: settings.speed,
        model: VOICE_CATALOG[0]?.id ?? "unknown",
      };
      const note = input.note?.trim();
      saveSpeechFeedback(ctx.db, {
        agentId: input.agentId,
        turnId: input.turnId,
        rating: input.rating,
        note: note ? note : null,
        ...how,
        spoken: sentences.join("\n"),
      });
      return { saved: true };
    }),

  removeVoiceFeedback: publicProcedure
    .input(z.object({ turnId }))
    .mutation(({ ctx, input }) => ({ removed: deleteSpeechFeedback(ctx.db, input.turnId) })),

  /** Settings > Models > Voice, newest first */
  voiceFeedbackList: publicProcedure.query(({ ctx }) => listSpeechFeedback(ctx.db, 200)),
});
