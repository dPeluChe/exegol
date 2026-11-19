/** `exegol-agent`: the Exegol tools from a shell, for a CLI whose MCP client drops arguments */

export const AGENT_CLI = "exegol-agent";
export const AGENT_BIN = "exegol-agent-bin.js";

export const AGENT_CLI_USAGE = `Exegol tools from a shell, as this session.

  ${AGENT_CLI} send [--reply-to <id>] [--no-reply] [--id <key>] <session> [--] <message>
  ${AGENT_CLI} status <message-id>
  ${AGENT_CLI} call <tool> ['<json arguments>']
  ${AGENT_CLI} tools [<tool>]

A message or the JSON given as - is read from stdin. The answer is JSON on stdout.`;

export type AgentCliCommand =
  | { kind: "call"; tool: string; args: Record<string, unknown>; stdin?: "message" | "args" }
  | { kind: "tools"; name?: string }
  | { kind: "usage"; error?: string };

const usage = (error?: string): AgentCliCommand => ({ kind: "usage", error });

function sendCommand(rest: string[]): AgentCliCommand {
  const args: Record<string, unknown> = {};
  const words: string[] = [];
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i] as string;
    // After --, everything is the message: a word of it may look like a flag
    if (arg === "--") {
      words.push(...rest.slice(i + 1));
      break;
    }
    if (arg === "--no-reply") args.expects_reply = false;
    else if (arg === "--reply-to" || arg === "--id") {
      const value = rest[++i];
      if (!value) return usage(`${arg} needs a value`);
      args[arg === "--id" ? "message_id" : "in_reply_to"] = value;
    } else if (arg.startsWith("--")) return usage(`unknown flag: ${arg} (put -- before a message)`);
    else words.push(arg);
  }
  const [target, ...message] = words;
  if (!target || message.length === 0) return usage("send needs a session and a message");
  args.target = target;
  if (message.length === 1 && message[0] === "-") {
    return { kind: "call", tool: "agent_send", args, stdin: "message" };
  }
  args.message = message.join(" ");
  return { kind: "call", tool: "agent_send", args };
}

function callCommand(rest: string[]): AgentCliCommand {
  const [tool, json, ...more] = rest;
  if (!tool || more.length > 0) return usage("call takes a tool and one JSON argument");
  if (json === "-") return { kind: "call", tool, args: {}, stdin: "args" };
  const args = json === undefined ? {} : jsonObject(json);
  return args ? { kind: "call", tool, args } : usage("the arguments are not a JSON object");
}

export function jsonObject(text: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(text);
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

export function parseAgentCli(argv: string[]): AgentCliCommand {
  const [command, ...rest] = argv;
  switch (command) {
    case "send":
      return sendCommand(rest);
    case "status":
      return rest.length === 1
        ? { kind: "call", tool: "message_status", args: { message_id: rest[0] } }
        : usage("status takes one message id");
    case "call":
      return callCommand(rest);
    case "tools":
      return { kind: "tools", name: rest[0] };
    case undefined:
    case "help":
    case "--help":
    case "-h":
      return usage();
    default:
      return usage(`unknown command: ${command}`);
  }
}

interface ListedTool {
  name: string;
  description?: string;
  inputSchema?: { required?: string[] };
}

/** One line per tool with what it needs, or one tool in full */
export function toolsAnswer(tools: ListedTool[], name?: string): unknown {
  if (name) return tools.find((t) => t.name === name) ?? { error: `no tool named ${name}` };
  return tools.map((t) => ({ name: t.name, needs: t.inputSchema?.required ?? [] }));
}

/** What the shell shows of a tool's answer: its text; an image says only that it exists */
export function printable(answer: unknown): unknown {
  const blocks = (answer as { __mcpContent?: unknown } | null)?.__mcpContent;
  if (!Array.isArray(blocks)) return answer;
  return blocks.map((block: { type?: string; text?: string }) =>
    block.type === "text" ? block.text : { type: block.type, omitted: "not shown in a shell" },
  );
}
