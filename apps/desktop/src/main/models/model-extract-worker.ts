import { parentPort, workerData } from "node:worker_threads";
import { extractTarBz2 } from "./extract";

// bzip2 in JS takes about a minute for a 500 MB model: off the main thread that pumps PTY output
extractTarBz2(workerData)
  .then(() => parentPort?.postMessage({ ok: true }))
  .catch((err: unknown) =>
    parentPort?.postMessage({ ok: false, error: err instanceof Error ? err.message : String(err) }),
  );
