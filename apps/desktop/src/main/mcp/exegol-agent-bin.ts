/**
 * `exegol-agent`: one Exegol tool call from a shell, with the session's own token. Runs with
 * ELECTRON_RUN_AS_NODE from the launcher Exegol writes. Stdout is the answer, stderr the errors.
 */

import { connect } from "node:net";
import { AGENT_CLI_USAGE, jsonObject, parseAgentCli, printable, toolsAnswer } from "./agent-cli";
import { SESSION_TOKEN_ENV } from "./exegol-mcp-token-file";
import {
  createFrameReader,
  encodeRequest,
  type JsonRpcResponse,
  MCP_SOCK_PATH,
} from "./exegol-protocol";

const TIMEOUT_MS = 30_000;

const fail = (message: string, code = 1): never => {
  process.stderr.write(`${message}\n`);
  process.exit(code);
};

const STDIN_TIMEOUT_MS = 10_000;

// The session's own, from its env: a token file or the folder's .mcp.json can be a sibling's
const token = process.env[SESSION_TOKEN_ENV] ?? "";

function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    let text = "";
    const timer = setTimeout(
      () => reject(new Error("nothing arrived on stdin: pipe the text in, or pass it as words")),
      STDIN_TIMEOUT_MS,
    );
    process.stdin.setEncoding("utf-8");
    process.stdin.on("data", (chunk) => {
      text += chunk;
    });
    process.stdin.on("end", () => {
      clearTimeout(timer);
      if (text.trim()) resolve(text);
      else reject(new Error("stdin was empty"));
    });
  });
}

function request(method: string, params: Record<string, unknown>): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const socket = connect(MCP_SOCK_PATH);
    let settled = false;
    const settle = (act: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      act();
    };
    const lost = (why: string) => settle(() => reject(new Error(why)));
    const timer = setTimeout(
      () => lost("Exegol did not answer in 30s: the call may or may not have run"),
      TIMEOUT_MS,
    );
    // No ppid: the token is this session's, and a walk up from a launcher's shell names nobody
    socket.on("connect", () => socket.write(encodeRequest(1, method, { ...params, token })));
    socket.on(
      "data",
      createFrameReader<JsonRpcResponse>(
        (msg) =>
          settle(() => (msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result))),
        () => lost("the answer is too large for a shell: use the MCP tool"),
      ),
    );
    socket.on("error", () => lost("Exegol is not reachable: is the app running?"));
    socket.on("close", () => lost("Exegol closed the connection without an answer"));
  });
}

async function main(): Promise<void> {
  const command = parseAgentCli(process.argv.slice(2));
  if (command.kind === "usage") {
    if (command.error) fail(`${command.error}\n\n${AGENT_CLI_USAGE}`, 2);
    process.stdout.write(`${AGENT_CLI_USAGE}\n`);
    return;
  }
  if (!token) fail(`no ${SESSION_TOKEN_ENV} in this shell: run it inside an Exegol session`);
  let answer: unknown;
  if (command.kind === "tools") {
    const listed = (await request("list_tools", {})) as { tools?: never[] } | null;
    answer = toolsAnswer(listed?.tools ?? [], command.name);
  } else {
    let args = command.args;
    if (command.stdin === "message") args = { ...args, message: (await readStdin()).trim() };
    if (command.stdin === "args") {
      args = jsonObject(await readStdin()) ?? fail("stdin is not a JSON object", 2);
    }
    answer = await request("call_tool", { tool: command.tool, args });
  }
  process.stdout.write(`${JSON.stringify(printable(answer), null, 2)}\n`);
}

main().catch((err) => fail(err instanceof Error ? err.message : String(err)));
