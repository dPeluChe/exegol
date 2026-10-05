import { execFile } from "node:child_process";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import { _getFullPath } from "../agents/spawn-env";
import { childEnv } from "./child-env";

const execFileAsync = promisify(execFile);

export interface PrintResult {
  text: string;
  inputTokens: number;
  outputTokens: number;
}

/**
 * One prompt through the logged-in Claude CLI (`claude -p`), for an AI feature the user asked
 * for when no API key is set: no tools, MCP, settings or session file, run from the temp dir so
 * no project's CLAUDE.md is read. The prompt goes on stdin (a diff does not fit argv)
 */
export async function runClaudePrint(
  prompt: string,
  model: string,
  timeoutMs: number,
): Promise<PrintResult> {
  const run = execFileAsync(
    "claude",
    [
      "-p",
      "--output-format",
      "json",
      "--model",
      model,
      "--tools",
      "",
      "--strict-mcp-config",
      "--setting-sources",
      "",
      "--no-session-persistence",
    ],
    // The login shell's PATH: launched from Finder, the app's own lacks ~/.local/bin
    { cwd: tmpdir(), env: { ...childEnv(), PATH: _getFullPath() }, timeout: timeoutMs },
  );
  run.child.stdin?.end(prompt);
  let stdout: string;
  try {
    ({ stdout } = await run);
  } catch (err) {
    // A failed turn still prints its JSON (is_error); anything else is the CLI missing or killed
    stdout = (err as { stdout?: string }).stdout ?? "";
    if (!stdout)
      throw new Error(`No Anthropic API key and claude -p failed: ${(err as Error).message}`);
  }
  const data = JSON.parse(stdout) as {
    result?: string;
    is_error?: boolean;
    usage?: { input_tokens?: number; output_tokens?: number };
  };
  if (data.is_error) throw new Error(`claude -p: ${(data.result ?? "error").slice(0, 200)}`);
  return {
    text: (data.result ?? "").trim(),
    inputTokens: data.usage?.input_tokens ?? 0,
    outputTokens: data.usage?.output_tokens ?? 0,
  };
}
