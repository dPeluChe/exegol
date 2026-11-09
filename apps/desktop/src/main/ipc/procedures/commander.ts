import { SPEECH_SPEED_MAX, SPEECH_SPEED_MIN } from "@exegol/shared";
import { z } from "zod";
import { trustOwnFolder } from "../../agents/claude-trust";
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
import { listVoiceModels } from "../../models/manager";
import { publicProcedure, router } from "../trpc";

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
    // Its brief is Exegol's own: Claude's trust gate there would take the first message as its answer
    await trustOwnFolder(project.path);
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
});
