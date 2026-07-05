import { runDoctorChecks } from "../../system/doctor";
import { publicProcedure, router } from "../trpc";

export const doctorRouter = router({
  /** Health check summary — used by the onboarding wizard and Settings > Doctor. */
  run: publicProcedure.query(({ ctx }) => runDoctorChecks(ctx.db)),
});
