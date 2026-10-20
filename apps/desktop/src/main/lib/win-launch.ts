// Node refuses to spawn a .cmd/.bat directly on Windows (CVE-2024-27980): those go through
// cmd.exe with every argument quoted and cmd's metacharacters caret-escaped (cross-spawn's rule).

const CMD_META = /([()\][%!^"`<>&|;, *?])/g;

function escapeArg(arg: string): string {
  const quoted = `"${arg.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\*)$/, "$1$1")}"`;
  return quoted.replace(CMD_META, "^$1");
}

export interface Launch {
  command: string;
  args: string[];
  /** The args are one cmd.exe command line, passed as written */
  verbatim: boolean;
}

/** How to start `argv` on `platform`: as is, or a Windows script through cmd.exe */
export function launchFor(
  argv: [string, ...string[]],
  platform: NodeJS.Platform,
  comspec = "cmd.exe",
): Launch {
  const [command, ...args] = argv;
  if (platform !== "win32" || !/\.(cmd|bat)$/i.test(command)) {
    return { command, args, verbatim: false };
  }
  const line = [command.replace(CMD_META, "^$1"), ...args.map(escapeArg)].join(" ");
  return { command: comspec, args: ["/d", "/s", "/c", `"${line}"`], verbatim: true };
}
