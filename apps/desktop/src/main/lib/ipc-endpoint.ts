// Where a local JSON-RPC server listens: a Unix socket file in ~/.exegol, or on Windows a named
// pipe (Node has no Unix sockets there), named per user so two accounts never share one.
// Bundled by the PTY sidecar and the MCP shim bins: no imports beyond node.
import { homedir, userInfo } from "node:os";
import { join } from "node:path";

export function ipcEndpoint(
  name: string,
  platform: NodeJS.Platform = process.platform,
  dir: string = join(homedir(), ".exegol"),
  user: () => string = () => userInfo().username,
): string {
  if (platform !== "win32") return join(dir, `${name}.sock`);
  let account = "";
  try {
    account = user();
  } catch {
    /* no account name: the pipe is still per session */
  }
  const safe = account.replace(/[^A-Za-z0-9_.-]/g, "_") || "user";
  return `\\\\.\\pipe\\exegol-${safe}-${name}`;
}

/** A named pipe vanishes with its server: no file to chmod, stat or unlink */
export function isNamedPipe(endpoint: string): boolean {
  return endpoint.startsWith("\\\\.\\pipe\\");
}
