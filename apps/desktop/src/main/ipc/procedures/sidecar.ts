import { app } from "electron";
import { logger } from "../../lib/logger";
import { allowQuit } from "../../system/work-guard";
import { getPtyHost } from "../../terminal/pty-host";
import { reconnectSidecar, stopSidecarProcess } from "../../terminal/pty-sidecar-discovery";
import { getSidecarHealth, markSidecarAnswering } from "../../terminal/sidecar-health-watch";
import { publicProcedure, router } from "../trpc";

/** The terminals banner: health for a window that mounts mid-stall, Retry and Restart */
export const sidecarRouter = router({
  health: publicProcedure.query(() => getSidecarHealth()),

  /** A new socket to the same sidecar; every session keeps running */
  retry: publicProcedure.mutation(async () => {
    try {
      const repainted = getPtyHost().swapSidecarClient(await reconnectSidecar());
      logger.info("[Sidecar] Retry: reconnected to the running sidecar");
      markSidecarAnswering();
      await repainted;
      return { ok: true };
    } catch (err) {
      logger.warn(`[Sidecar] Retry failed: ${err instanceof Error ? err.message : String(err)}`);
      return { ok: false };
    }
  }),

  /** Last resort: end the sidecar and relaunch. Startup recovery then marks every session
   *  crashed (history kept) and offers them for resume, as after a reboot */
  restart: publicProcedure.mutation(async () => {
    logger.warn("[Sidecar] Restart terminals: stopping the sidecar and relaunching");
    await stopSidecarProcess(getPtyHost().getSidecarClient());
    allowQuit();
    app.relaunch();
    setTimeout(() => app.quit(), 100);
    return { ok: true };
  }),
});
