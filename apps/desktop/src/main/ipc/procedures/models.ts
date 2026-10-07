import { DEFAULT_SPEECH_MODEL_KEY } from "@exegol/shared";
import { z } from "zod";
import { getJsonSetting, setJsonSetting } from "../../db/queries/settings";
import { DEFAULT_MODEL_ID, findModel } from "../../models/catalog";
import { cancelModel, deleteModel, downloadModel, listModels } from "../../models/manager";
import { publicProcedure, router } from "../trpc";

const id = z
  .string()
  .regex(/^[a-z0-9][a-z0-9.-]*$/)
  .refine((value) => !!findModel(value), "unknown model");
const modelId = z.object({ id });

// A non-commercial license is only accepted with the user's explicit OK from the confirm dialog
const licensedModel = z
  .object({ id, acceptNonCommercial: z.boolean().default(false) })
  .refine(
    (input) => input.acceptNonCommercial || findModel(input.id)?.commercialUse !== false,
    "this model's license is non-commercial: confirm it first",
  );

/** Local speech-to-text models: catalog, downloads, default (Settings > Models) */
export const modelsRouter = router({
  list: publicProcedure.query(({ ctx }) =>
    listModels(getJsonSetting(ctx.db, DEFAULT_SPEECH_MODEL_KEY, DEFAULT_MODEL_ID)),
  ),

  /** Returns at once; progress arrives on `models:progress` */
  download: publicProcedure.input(licensedModel).mutation(({ input }) => {
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

  setDefault: publicProcedure.input(licensedModel).mutation(({ ctx, input }) => {
    setJsonSetting(ctx.db, DEFAULT_SPEECH_MODEL_KEY, input.id);
    return { ok: true };
  }),
});
