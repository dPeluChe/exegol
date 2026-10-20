import { agentStatusSchema } from "@exegol/shared";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { saveActiveView } from "../../agents/active-view";
import { isAgentAwaitingApproval } from "../../agents/agent-messaging";
import { folderExists } from "../../agents/auto-resume";
import {
  FOLLOW_UP_MAX_CHARS,
  FollowUpError,
  listFollowUps,
  queueFollowUp,
  removeFollowUp,
  steerFollowUp,
} from "../../agents/follow-up-queue";
import { hookCwdOf } from "../../agents/hook-cwd";
import { setIdleExempt } from "../../agents/idle-exempt";
import { broadcastShellClosed } from "../../agents/spawn-env";
import {
  getAgent,
  getWorktreeByAgentId,
  listAgents,
  listRecentSessions,
  setAgentMuted,
  setAgentSuspended,
  updateAgentStatus,
} from "../../db/queries";
import {
  archiveAgent,
  archiveEndedAgents,
  deleteShellRow,
  getAgentLastCwd,
  listActiveAgents,
  setAgentAlias,
  setAgentPrWatch,
} from "../../db/queries/agents";
import { getPrWatchStatus, onPrWatchToggled } from "../../integrations/github/pr-watch";
import { getMcpAgentStates } from "../../mcp/exegol-server";
import { getPtyHost } from "../../terminal/pty-host";
import { getRecoveryState } from "../../terminal/reattach-gate";
import { publicProcedure, router } from "../trpc";
import { agentParallelProcedures } from "./agents-parallel";
import { agentProviderProcedures } from "./agents-providers";
import { agentSpawnProcedures } from "./agents-resume";

async function followUpCall<T>(run: () => T | Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (err) {
    if (err instanceof FollowUpError)
      throw new TRPCError({ code: "BAD_REQUEST", message: err.message });
    throw err;
  }
}

export const agentRouter = router({
  ...agentProviderProcedures,
  ...agentSpawnProcedures,
  ...agentParallelProcedures,
  recentSessions: publicProcedure
    .input(z.object({ limit: z.number().int().positive().optional() }).optional())
    .query(({ ctx, input }) => {
      return listRecentSessions(ctx.db, input?.limit ?? 10);
    }),
  list: publicProcedure.input(z.object({ projectId: z.string() })).query(({ ctx, input }) => {
    return listAgents(ctx.db, input.projectId);
  }),
  /** T156: cross-project non-terminal agents (project name + group color). */
  // At once, even mid-recovery: the sidebar lists sessions while they reconnect (recoveryState)
  listActive: publicProcedure.query(({ ctx }) => listActiveAgents(ctx.db)),
  /** Startup reattach progress; `recovery:progress` pushes each change */
  recoveryState: publicProcedure.query(() => getRecoveryState()),
  /** The view on screen: the next startup reattaches its sessions first */
  setActiveView: publicProcedure
    .input(
      z.object({
        projectId: z.string().max(128).nullable(),
        agentIds: z.array(z.string().max(128)).max(64),
      }),
    )
    .mutation(({ ctx, input }) => saveActiveView(ctx.db, input)),
  /** T176: dismiss ended sessions from the dashboard. Archive, not delete —
   *  the row keeps its scoring, oplog attribution and resume handle. */
  archive: publicProcedure
    .input(z.object({ id: z.string() }))
    .mutation(({ ctx, input }) => ({ archived: archiveAgent(ctx.db, input.id) })),
  archiveEnded: publicProcedure
    .input(z.object({ projectId: z.string().optional() }).optional())
    .mutation(({ ctx, input }) => ({ archived: archiveEndedAgents(ctx.db, input?.projectId) })),
  setAlias: publicProcedure
    .input(z.object({ id: z.string(), alias: z.string().trim().max(40).nullable() }))
    .mutation(({ ctx, input }) => {
      setAgentAlias(ctx.db, input.id, input.alias || null);
      return { success: true };
    }),
  // Returns null (not undefined) for consistency with TanStack Query v5,
  // which treats undefined from queryFn as a protocol error.
  get: publicProcedure.input(z.object({ id: z.string() })).query(({ ctx, input }) => {
    return getAgent(ctx.db, input.id) ?? null;
  }),
  // Idempotent: if the agent is already gone (race with a concurrent close),
  // return success instead of NOT_FOUND so the renderer's double-call
  // cleanup pattern (stop + delete) doesn't spam the console.
  /** Keep a live session out of Needs attention and notifications, or bring it back */
  setMuted: publicProcedure
    .input(z.object({ id: z.string(), muted: z.boolean() }))
    .mutation(({ ctx, input }) => {
      setAgentMuted(ctx.db, input.id, input.muted);
      return getAgent(ctx.db, input.id);
    }),
  /** T142 phase 1: tell the agent about its PR's failing checks, reviews and conflicts */
  setPrWatch: publicProcedure
    .input(z.object({ id: z.string(), on: z.boolean() }))
    .mutation(({ ctx, input }) => {
      setAgentPrWatch(ctx.db, input.id, input.on ? Date.now() : null);
      onPrWatchToggled(input.id, input.on);
      return getAgent(ctx.db, input.id);
    }),
  /** What the PR watch last saw (in memory, never calls gh) */
  prWatchStatus: publicProcedure
    .input(z.object({ id: z.string() }))
    .query(({ input }) => getPrWatchStatus(input.id)),
  /** Stop quietly and keep the session for Resume (marked before the stop, so its exit is quiet too) */
  suspend: publicProcedure.input(z.object({ id: z.string() })).mutation(async ({ ctx, input }) => {
    if (!getAgent(ctx.db, input.id)) return null;
    setAgentSuspended(ctx.db, input.id, Math.floor(Date.now() / 1000));
    await ctx.agentManager.stop(ctx.db, input.id);
    return getAgent(ctx.db, input.id);
  }),
  /** Sessions the idle sweep leaves alone: pinned in Watching or with an unread attention item */
  setIdleExempt: publicProcedure
    .input(z.object({ agentIds: z.array(z.string().max(128)).max(500) }))
    .mutation(({ input }) => {
      setIdleExempt(input.agentIds);
      return { ok: true };
    }),
  /** The numbered question the agent's screen is waiting on (permission prompt, approval) */
  screenDialog: publicProcedure
    .input(z.object({ id: z.string() }))
    .query(({ input }) => getPtyHost().screenDialog(input.id)),
  /** Press one option, only on an agent waiting on the same question the user saw: two prompts
   *  in a row both offer 1/2/3, and a stale click must not answer the next one */
  answerDialog: publicProcedure
    .input(
      z.object({
        id: z.string(),
        key: z.string().regex(/^\d$/),
        fingerprint: z.string().max(8000),
      }),
    )
    .mutation(({ ctx, input }) => {
      const agent = getAgent(ctx.db, input.id);
      const waiting = agent?.status === "waiting_input" || isAgentAwaitingApproval(input.id);
      const dialog = getPtyHost().screenDialog(input.id);
      if (
        !agent ||
        agent.cliType === "shell" ||
        !waiting ||
        dialog?.fingerprint !== input.fingerprint ||
        !dialog.options.some((o) => o.key === input.key)
      ) {
        throw new TRPCError({ code: "CONFLICT", message: "That question is no longer on screen" });
      }
      ctx.agentManager.write(input.id, input.key);
      return { ok: true };
    }),
  /** Which live agents have the Exegol MCP tools connected (pushed on mcp:status after this) */
  mcpStatus: publicProcedure.query(({ ctx }) => ({ agents: getMcpAgentStates(ctx.db) })),
  /** T200.4: the user's follow-up queue, typed at the agent's turn boundary (in memory) */
  followUps: publicProcedure
    .input(z.object({ id: z.string() }))
    .query(({ input }) => listFollowUps(input.id)),
  queueFollowUp: publicProcedure
    .input(z.object({ id: z.string(), text: z.string().min(1).max(FOLLOW_UP_MAX_CHARS) }))
    .mutation(({ ctx, input }) => followUpCall(() => queueFollowUp(ctx.db, input.id, input.text))),
  removeFollowUp: publicProcedure
    .input(z.object({ id: z.string(), itemId: z.string().max(100) }))
    .mutation(({ input }) => removeFollowUp(input.id, input.itemId)),
  /** Interrupt, wait for the prompt (STEER_TIMEOUT_MS cap), type; past the cap it stays queued */
  steer: publicProcedure
    .input(z.object({ id: z.string(), text: z.string().min(1).max(FOLLOW_UP_MAX_CHARS) }))
    .mutation(({ ctx, input }) => followUpCall(() => steerFollowUp(ctx.db, input.id, input.text))),
  stop: publicProcedure.input(z.object({ id: z.string() })).mutation(async ({ ctx, input }) => {
    const agent = getAgent(ctx.db, input.id);
    if (!agent) return null;
    await ctx.agentManager.stop(ctx.db, input.id);
    return getAgent(ctx.db, input.id) ?? agent;
  }),
  /**
   * Closing a pane retires the session — it does NOT destroy it.
   *
   * This used to be `DELETE FROM agents`, and it is the normal way a session
   * ends (close pane, Cmd+W, scrollback dismiss). The FKs cascade, so the
   * score, the token spend, the oplog and the final output went with the row —
   * defeating T181's whole retention change through the most-travelled path.
   * `listAgents` filters archived rows, so the UI behaves identically.
   *
   * Shells are still deleted: they are terminal tabs, with nothing to keep.
   */
  delete: publicProcedure.input(z.object({ id: z.string() })).mutation(({ ctx, input }) => {
    const agent = getAgent(ctx.db, input.id);
    if (agent?.cliType === "shell") {
      deleteShellRow(ctx.db, agent.id);
      broadcastShellClosed(agent);
      return { success: true, archived: false };
    }
    archiveAgent(ctx.db, input.id);
    return { success: true, archived: true };
  }),
  // Returns null instead of throwing: stale pane references to deleted
  // agents are a recoverable state, not an error.
  getStatus: publicProcedure.input(z.object({ id: z.string() })).query(({ ctx, input }) => {
    const agent = getAgent(ctx.db, input.id);
    if (!agent) return null;
    return {
      status: agent.status,
      currentStep: agent.currentStep,
    };
  }),
  // No-ops silently if the agent was deleted mid-update (e.g., user closed
  // the pane while a push event was in flight).
  updateStatus: publicProcedure
    .input(
      z.object({
        id: z.string(),
        status: agentStatusSchema,
        currentStep: z.string().optional(),
      }),
    )
    .mutation(({ ctx, input }) => {
      const agent = getAgent(ctx.db, input.id);
      if (!agent) return null;
      updateAgentStatus(ctx.db, input.id, input.status, input.currentStep);
      return getAgent(ctx.db, input.id) ?? null;
    }),
  /** T106 — Resolve the on-disk worktree path for an agent (for "View diff"). */
  getWorktreePath: publicProcedure
    .input(z.object({ agentId: z.string() }))
    .query(({ ctx, input }) => worktreePathOf(ctx.db, input.agentId)),
  /** Where an ended session worked: a shell's last folder, else its worktree; null is the root
   *  (also when that folder is gone: Files must not open a missing dir). `live` first takes the
   *  folder the CLI's hooks last reported (a cd inside the session) */
  sessionFolder: publicProcedure
    .input(z.object({ agentId: z.string().max(128), live: z.boolean().optional() }))
    .query(({ ctx, input }) => {
      const live = input.live ? hookCwdOf(input.agentId) : null;
      if (live && folderExists(live)) return live;
      // A shell's OSC 7 folder, or the folder the launcher started an agent in
      const folder =
        getAgentLastCwd(ctx.db, input.agentId) ?? worktreePathOf(ctx.db, input.agentId);
      return folderExists(folder) ? folder : null;
    }),

  // ─── T65: Parallel Multi-Agent ────────────────────────────────────────
});

function worktreePathOf(db: Parameters<typeof getAgent>[0], agentId: string): string | null {
  const owned = getWorktreeByAgentId(db, agentId)?.path;
  if (owned) return owned;
  // An agent that joined another's worktree (a reuse, a terminal beside it) links it here
  const joined = db
    .prepare("SELECT w.path FROM agents a JOIN worktrees w ON w.id = a.worktree_id WHERE a.id = ?")
    .get(agentId) as { path: string } | undefined;
  return joined?.path ?? null;
}
