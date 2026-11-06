import { execFile } from "node:child_process";
import { promisify } from "node:util";

const raw = promisify(execFile);

/** Every child of the GUI app stays out of sight: Windows opens a console for each one otherwise */
export const execFileAsync = ((file: string, args: string[], options?: object) =>
  raw(file, args, { windowsHide: true, ...options })) as typeof raw;
