import { ExegolToolError } from "./exegol-protocol";
import { EXEGOL_TOOL_DEFS } from "./exegol-tool-defs";

const required = new Map(
  EXEGOL_TOOL_DEFS.map((def) => [
    def.name as string,
    (def.inputSchema as { required?: string[] }).required ?? [],
  ]),
);

/** The arguments a tool reads. A client that sends them as JSON text is read; a call with none
 *  for a tool that needs some says so and names them, so the caller does not take the tool's
 *  own "requires target" for a broken connection and send the same empty call again */
export function toolArguments(tool: string, raw: unknown): Record<string, unknown> {
  let args: unknown = raw;
  if (typeof raw === "string") {
    try {
      args = JSON.parse(raw);
    } catch {
      args = null;
    }
  }
  const given =
    args && typeof args === "object" && !Array.isArray(args)
      ? (args as Record<string, unknown>)
      : {};
  const needs = required.get(tool) ?? [];
  if (needs.length > 0 && Object.keys(given).length === 0) {
    throw new ExegolToolError(
      `${tool} received no arguments. It needs: ${needs.join(", ")}. The call reached Exegol, so the connection works: send them as the call's arguments object (a client that wraps MCP calls takes them inside its own "arguments" field) and call again.`,
      -32602,
    );
  }
  return given;
}
