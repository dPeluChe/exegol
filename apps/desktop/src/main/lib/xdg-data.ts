import { homedir } from "node:os";
import { join } from "node:path";

/** Where CLIs that follow XDG keep their data */
export const xdgDataDir = (): string =>
  process.env.XDG_DATA_HOME || join(homedir(), ".local", "share");
