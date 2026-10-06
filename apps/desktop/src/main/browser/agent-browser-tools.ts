import { hostOf } from "@exegol/shared";
import type Database from "libsql";
import { logger } from "../lib/logger";
import {
  BROWSER_READ_TOOLS,
  BROWSER_WRITE_TOOLS,
  type BrowserToolName,
  ExegolToolError,
} from "../mcp/exegol-protocol";
import { forgetAgentControl } from "./control";
import {
  type BrowserToolContext,
  logAction,
  requireHost,
  resolvePane,
  userHasControl,
} from "./tool-guards";
import {
  clearAgentWaits,
  handleEval,
  handleList,
  handleLogs,
  handleNavigate,
  handleOpen,
  handlePress,
  handleScreenshot,
  handleSnapshot,
  handleWait,
  runAction,
} from "./tool-handlers";

const MAX_TYPE_CHARS = 5_000;
const BROWSER_TOOLS: readonly string[] = [...BROWSER_READ_TOOLS, ...BROWSER_WRITE_TOOLS];

export const isBrowserTool = (tool: string): tool is BrowserToolName =>
  BROWSER_TOOLS.includes(tool);

/** The agent exited: its waits and "needs you" flags must not outlive it */
export function forgetBrowserAgent(agentId: string): void {
  clearAgentWaits(agentId);
  forgetAgentControl(agentId);
}

/** Dispatch one browser tool. Access mode (already checked by callExegolTool) and project come
 *  from the caller's token, server side */
export async function callBrowserTool(
  db: Database.Database,
  tool: BrowserToolName,
  args: Record<string, unknown>,
  ctx: BrowserToolContext,
): Promise<unknown> {
  if (tool === "browser_list") return handleList(db, ctx);
  if (tool === "browser_open") return handleOpen(db, ctx, args);
  if (tool === "browser_wait_for_user") return handleWait(db, ctx, args);

  const pane = resolvePane(requireHost().livePanes(ctx.projectId), ctx, args.pane);
  const blocked = userHasControl(pane);
  if (blocked) return blocked;
  let result: unknown;
  try {
    switch (tool) {
      case "browser_snapshot":
        result = await handleSnapshot(db, ctx, pane);
        break;
      case "browser_screenshot":
        result = await handleScreenshot(db, ctx, pane);
        break;
      case "browser_logs":
        result = await handleLogs(db, ctx, pane, args);
        break;
      case "browser_navigate":
        result = await handleNavigate(db, ctx, pane, args);
        break;
      case "browser_click":
        result = await runAction(db, ctx, pane, args.ref, { action: "click" });
        break;
      case "browser_type": {
        const text = typeof args.text === "string" ? args.text : "";
        if (text.length > MAX_TYPE_CHARS) {
          throw new ExegolToolError(`text too long (max ${MAX_TYPE_CHARS})`, -32602);
        }
        result = await runAction(db, ctx, pane, args.ref, {
          action: "type",
          text,
          submit: args.submit === true,
          append: args.append === true,
        });
        break;
      }
      case "browser_press":
        result = await handlePress(db, ctx, pane, args);
        break;
      case "browser_select":
        result = await runAction(db, ctx, pane, args.ref, {
          action: "select",
          value: String(args.value ?? ""),
        });
        break;
      case "browser_eval":
        result = await handleEval(db, ctx, pane, args);
        break;
    }
  } catch (err) {
    logAction(db, ctx, {
      tool,
      paneId: pane.paneId,
      host: hostOf(pane.getUrl()),
      outcome: "error",
    });
    if (!(err instanceof ExegolToolError)) logger.warn(`[AgentBrowser] ${tool} failed:`, err);
    throw err;
  }
  if (tool !== "browser_logs" && tool !== "browser_snapshot") {
    const status = (result as { status?: string } | null)?.status ?? "ok";
    logAction(db, ctx, { tool, paneId: pane.paneId, host: hostOf(pane.getUrl()), outcome: status });
  }
  return result;
}
