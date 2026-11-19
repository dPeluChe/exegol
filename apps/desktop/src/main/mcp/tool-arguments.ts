import { z } from "zod";
import { parseJson } from "../lib/parse-json";
import { AGENT_CLI } from "./agent-cli";
import { ExegolToolError } from "./exegol-protocol";
import { EXEGOL_TOOL_DEFS } from "./exegol-tool-defs";

const required = new Map(
  EXEGOL_TOOL_DEFS.map((def) => [
    def.name as string,
    (def.inputSchema as { required?: string[] }).required ?? [],
  ]),
);

const Fields = z.record(z.string(), z.unknown());

/** The arguments a tool reads. A call that carries none of the fields its tool needs says so
 *  and names them: the tool's own "requires target" reads like lost data, and the caller sends
 *  the same empty call again. Arguments sent as JSON text, or one level too deep, are read */
export function toolArguments(tool: string, raw: unknown): Record<string, unknown> {
  const needs = required.get(tool) ?? [];
  const has = (fields: Record<string, unknown>) => needs.some((key) => key in fields);
  const parsed = typeof raw === "string" && raw.trim() ? parseJson(raw, Fields) : raw;
  if (typeof raw === "string" && raw.trim() && !parsed) {
    throw new ExegolToolError(
      `${tool} received its arguments as text that is not a JSON object. Send an object.`,
      -32602,
    );
  }
  const given = Fields.safeParse(parsed).data ?? {};
  if (needs.length === 0 || has(given)) return given;
  const inner = Fields.safeParse(given.arguments).data;
  if (inner && has(inner)) return inner;
  throw new ExegolToolError(
    `${tool} received none of the arguments it needs: ${needs.join(", ")}. The call reached Exegol, so the connection works: send them as the call's arguments object (a client that wraps MCP calls takes them inside its own "arguments" field) and call again. If they keep arriving empty, run the tool from a shell: ${AGENT_CLI} help.`,
    -32602,
  );
}
