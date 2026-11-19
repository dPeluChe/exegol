/**
 * `exegol-agent`: one Exegol tool call from a shell, with the session's own token. Runs with
 * ELECTRON_RUN_AS_NODE from the launcher Exegol writes. Stdout is the answer, stderr the errors.
 */

import { connect } from "node:net";
import { AGENT_CLI_USAGE, jsonObject, parseAgentCli, toolsAnswer } from "./agent-cli";
import { SESSION_TOKEN_ENV, tokenFromEnvBlock } from "./exegol-mcp-token-file";
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

// Env only: the cwd's .mcp.json may hold another session's token
const token = process.env[SESSION_TOKEN_ENV] || tokenFromEnvBlock(process.env) || "";

function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    let text = "";
    process.stdin.setEncoding("utf-8");
    process.stdin.on("data", (chunk) => {
      text += chunk;
    });
    process.stdin.on("end", () => resolve(text));
    process.stdin.on("error", () => resolve(text));
  });
}

function request(method: string, params: Record<string, unknown>): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const socket = connect(MCP_SOCK_PATH);
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error("Exegol did not answer in 30s: the call may or may not have run"));
    }, TIMEOUT_MS);
    const done = (act: () => void) => {
      clearTimeout(timer);
      socket.destroy();
      act();
    };
    socket.on("connect", () =>
      socket.write(encodeRequest(1, method, { ...params, token, ppid: process.ppid })),
    );
    socket.on(
      "data",
      createFrameReader<JsonRpcResponse>((msg) =>
        done(() => (msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result))),
      ),
    );
    socket.on("error", () =>
      done(() => reject(new Error("Exegol is not reachable: is the app running?"))),
    );
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
  process.stdout.write(`${JSON.stringify(answer, null, 2)}\n`);
}

main().catch((err) => fail(err instanceof Error ? err.message : String(err)));
