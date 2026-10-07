import { DEFAULT_SPEECH_MODEL_KEY } from "@exegol/shared";
import { z } from "zod";
import { getJsonSetting, setJsonSetting } from "../../db/queries/settings";
import { DEFAULT_MODEL_ID, findModel } from "../../models/catalog";
import { cancelModel, deleteModel, downloadModel, listModels } from "../../models/manager";
import { publicProcedure, router } from "../trpc";

const modelId = z.object({
  id: z
    .string()
    .regex(/^[a-z0-9][a-z0-9.-]*$/)
    .refine((id) => !!findModel(id), "unknown model"),
});

/** Local speech-to-text models: catalog, downloads, default (Settings > Models) */
export const modelsRouter = router({
  list: publicProcedure.query(({ ctx }) =>
    listModels(getJsonSetting(ctx.db, DEFAULT_SPEECH_MODEL_KEY, DEFAULT_MODEL_ID)),
  ),

  /** Returns at once; progress arrives on `models:progress` */
  download: publicProcedure.input(modelId).mutation(({ input }) => {
    void downloadModel(input.id);
    return { started: true };
  }),

  cancel: publicProcedure.input(modelId).mutation(({ input }) => {
    cancelModel(input.id);
    return { ok: true };
  }),

  delete: publicProcedure.input(modelId).mutation(async ({ input }) => {
    await deleteModel(input.id);
    return { ok: true };
  }),

  setDefault: publicProcedure.input(modelId).mutation(({ ctx, input }) => {
    setJsonSetting(ctx.db, DEFAULT_SPEECH_MODEL_KEY, input.id);
    return { ok: true };
  }),
});
