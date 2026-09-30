import { z } from "zod";
import { cliUpdateStatus } from "../../system/cli-versions";
import { runDoctorChecks } from "../../system/doctor";
import { publicProcedure, router } from "../trpc";

export const doctorRouter = router({
  /** Health check summary — used by the onboarding wizard and Settings > Doctor. */
  run: publicProcedure.query(({ ctx }) => runDoctorChecks(ctx.db)),
  /** Installed vs newest release of these CLIs, with each one's update command */
  cliUpdates: publicProcedure
    .input(z.object({ cliTypes: z.array(z.string().regex(/^[\w-]{1,40}$/)).max(20) }))
    .query(({ input }) => cliUpdateStatus(input.cliTypes)),
});
