import { safeStorage } from "electron";
import { z } from "zod";
import { deleteApiKey, getApiKey, listApiKeys, storeApiKey } from "../../security/keystore";
import { publicProcedure, router } from "../trpc";

export const apiKeysRouter = router({
  list: publicProcedure.query(({ ctx }) => {
    return listApiKeys(ctx.db);
  }),

  /** Whether OS-level encryption backs the keystore — false means plaintext fallback. */
  encryptionAvailable: publicProcedure.query(() => safeStorage.isEncryptionAvailable()),

  set: publicProcedure
    .input(z.object({ provider: z.string().min(1), key: z.string().min(1) }))
    .mutation(({ ctx, input }) => {
      storeApiKey(ctx.db, input.provider, input.key);
      return { success: true };
    }),

  delete: publicProcedure
    .input(z.object({ provider: z.string().min(1) }))
    .mutation(({ ctx, input }) => {
      deleteApiKey(ctx.db, input.provider);
      return { success: true };
    }),

  test: publicProcedure
    .input(z.object({ provider: z.string().min(1) }))
    .mutation(({ ctx, input }) => {
      const key = getApiKey(ctx.db, input.provider);
      return { success: !!key };
    }),
});
