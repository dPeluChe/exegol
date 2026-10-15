// The folder each CLI reported in its last hook payload (`cwd`): where it works now, after any
// cd. Memory only: last_cwd stays the folder a resume starts in.

const MAX_AGENTS = 500;
const folders = new Map<string, string>();

export function noteHookCwd(agentId: string, cwd: string | undefined): void {
  if (!cwd?.startsWith("/") || cwd.includes("\0")) return;
  folders.delete(agentId);
  folders.set(agentId, cwd);
  if (folders.size > MAX_AGENTS) {
    const oldest = folders.keys().next().value;
    if (oldest !== undefined) folders.delete(oldest);
  }
}

export const hookCwdOf = (agentId: string): string | null => folders.get(agentId) ?? null;
