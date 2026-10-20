import { posix } from "node:path";

// The AppImage case is Linux only: POSIX paths, so a test of it reads the same on any host
const { dirname, relative } = posix;

/** A bundled script run with the app's own binary as Node (ELECTRON_RUN_AS_NODE=1 in its env) */
export interface NodeLaunch {
  command: string;
  args: string[];
}

export interface LaunchContext {
  platform: string;
  execPath: string;
  /** Set by the AppImage runtime: the .AppImage file itself */
  appImage?: string;
}

const current = (): LaunchContext => ({
  platform: process.platform,
  execPath: process.execPath,
  appImage: process.env.APPIMAGE,
});

/**
 * How to run `script`, in a form that still works after this launch quits. An AppImage runs from
 * a FUSE mount that is gone once the app exits, so the command is the .AppImage file, which mounts
 * itself again, and the script is found from that new mount (its binary sits at the mount root)
 */
export function nodeLaunch(script: string, ctx: LaunchContext = current()): NodeLaunch {
  const root = dirname(ctx.execPath);
  if (ctx.platform !== "linux" || !ctx.appImage || !script.startsWith(`${root}/`)) {
    return { command: ctx.execPath, args: [script] };
  }
  const rel = JSON.stringify(relative(root, script));
  // runMain, not require: the guard only runs when it is the main module
  const code = `const p=require("path").join(require("path").dirname(process.execPath),${rel});process.argv.splice(1,0,p);require("module").runMain(p)`;
  return { command: ctx.appImage, args: ["-e", code] };
}

const quote = (s: string) => (/^[^"$`\\]*$/.test(s) ? `"${s}"` : `'${s.replace(/'/g, "'\\''")}'`);

/** The launch as one POSIX shell command line (a Claude hook command) */
export function nodeShellCommand(launch: NodeLaunch): string {
  return ["ELECTRON_RUN_AS_NODE=1", ...[launch.command, ...launch.args].map(quote)].join(" ");
}
