import { homedir } from "node:os";
import { join } from "node:path";

/** The Commander's home: Exegol makes it and writes its brief */
export const COMMANDER_DIR = join(homedir(), ".exegol", "commander");
