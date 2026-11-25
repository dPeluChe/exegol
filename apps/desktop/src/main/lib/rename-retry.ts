import { rename } from "node:fs/promises";

const BUSY = new Set(["EPERM", "EBUSY", "EACCES"]);

/** A rename that waits out Windows: an antivirus or indexer holding the file for a moment makes
 *  the swap fail with EPERM/EBUSY. Elsewhere one try, as a busy file there is a real refusal */
export async function renameWithRetry(
  from: string,
  to: string,
  platform: NodeJS.Platform = process.platform,
  tries = 5,
): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    try {
      await rename(from, to);
      return;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code ?? "";
      if (platform !== "win32" || !BUSY.has(code) || attempt >= tries) throw err;
      await new Promise((r) => setTimeout(r, 100 * attempt));
    }
  }
}
