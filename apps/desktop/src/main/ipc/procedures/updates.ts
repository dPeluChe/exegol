import { app } from "electron";
import { valid } from "semver";
import { z } from "zod";
import { getJsonSetting, setJsonSetting } from "../../db/queries/settings";
import { fetchReleaseNotes } from "../../system/release-notes";
import { getUpdateStatus } from "../../system/update-status";
import { publicProcedure, router } from "../trpc";

const LAST_SEEN_KEY = "lastSeenVersion";

/** What's new: the notes of a version found by the updater, and once after installing one */
export const updatesRouter = router({
  /** The updater's last status (the push only reaches windows already listening) */
  status: publicProcedure.query(() => getUpdateStatus()),

  /** Everything between the running version and the one being downloaded */
  notes: publicProcedure
    .input(z.object({ to: z.string().refine((v) => !!valid(v), "not a version") }))
    .query(({ input }) => fetchReleaseNotes(app.getVersion(), input.to)),

  /** After an update: the versions since the last one the user saw, once. A fresh install
   *  shows nothing and starts counting from here */
  whatsNew: publicProcedure.query(async ({ ctx }) => {
    const current = app.getVersion();
    const lastSeen = getJsonSetting<string | null>(ctx.db, LAST_SEEN_KEY, null);
    if (!lastSeen || !valid(lastSeen)) {
      setJsonSetting(ctx.db, LAST_SEEN_KEY, current);
      return null;
    }
    if (lastSeen === current) return null;
    const notes = await fetchReleaseNotes(lastSeen, current);
    return { version: current, notes };
  }),

  markSeen: publicProcedure.mutation(({ ctx }) => {
    setJsonSetting(ctx.db, LAST_SEEN_KEY, app.getVersion());
    return { ok: true };
  }),
});
