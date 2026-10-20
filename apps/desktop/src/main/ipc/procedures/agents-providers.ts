// agents router, provider registry part: built-in and custom CLIs, their args and models, preflight.
import type { AgentProvider } from "@exegol/shared";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { cliSetupFor, interruptKeyOf } from "../../agents/cli-catalog";
import { cliDefaultModel } from "../../agents/default-model";
import { listCliModels } from "../../agents/model-lists";
import { runPreflight } from "../../agents/preflight";
import { coreRust, resolveCommand } from "../../agents/spawn-env";
import { installedProviderIds } from "../../system/cli-versions";
import { publicProcedure } from "../trpc";

/** Each provider marked installed (one PATH check, the one spawn uses) with how to install it on
 *  this OS: the launcher and Settings > CLIs read the same answer */
function withInstallInfo(providers: AgentProvider[]): AgentProvider[] {
  const installed = installedProviderIds();
  return providers.map((p) => {
    const setup = cliSetupFor(p.id);
    return {
      ...p,
      installed: p.id === "shell" || installed.has(p.id),
      installCommand: setup?.install ?? null,
      installDocs: setup?.docs ?? null,
      interruptKey: interruptKeyOf(p.id),
    };
  });
}

export const agentProviderProcedures = {
  listProviders: publicProcedure.query(({ ctx }) => withInstallInfo(ctx.providerRegistry.list())),

  /** List only enabled providers (for launcher/modal UI — respects Settings toggles) */
  listEnabledProviders: publicProcedure.query(({ ctx }) =>
    withInstallInfo(
      ctx.providerRegistry.list().filter((p) => p.enabled !== false && p.id !== "shell"),
    ),
  ),

  registerProvider: publicProcedure
    .input(
      z.object({
        id: z.string().min(1),
        name: z.string().min(1),
        command: z.string().min(1),
        args: z.array(z.string()).default([]),
        env: z.record(z.string()).default({}),
        argsTemplate: z.string().default("{command} {task}"),
        icon: z.string().max(3).default("?"),
        color: z.string().default("#6B7280"),
        capabilities: z
          .object({
            supportsWorktree: z.boolean().default(false),
            supportsResume: z.boolean().default(false),
            resumeFlag: z.string().default(""),
            resumeCommandPattern: z.string().optional(),
            supportsRPC: z.boolean().default(false),
            supportsVision: z.boolean().default(false),
            supportsPromptArg: z.boolean().default(false),
            promptFlag: z.string().default(""),
            pipelineIdleCloseSeconds: z.number().default(0),
          })
          .default({}),
        enabled: z.boolean().default(true),
      }),
    )
    .mutation(({ ctx, input }) => {
      return ctx.providerRegistry.register(ctx.db, input);
    }),

  /** A custom CLI's name and command (it was created as "New Agent" / my-agent with no way to
   *  change either). Built-ins keep theirs */
  updateCustomProvider: publicProcedure
    .input(
      z.object({
        id: z.string(),
        name: z.string().trim().min(1).max(60),
        command: z
          .string()
          .trim()
          .min(1)
          .max(200)
          .regex(/^[^\n\r]+$/),
      }),
    )
    .mutation(({ ctx, input }) => {
      const provider = ctx.providerRegistry.get(input.id);
      if (!provider || provider.isBuiltin) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Only a custom CLI can be edited" });
      }
      provider.name = input.name;
      provider.command = input.command;
      ctx.providerRegistry.saveCustomToDb(ctx.db);
      return { success: true };
    }),

  unregisterProvider: publicProcedure
    .input(z.object({ id: z.string() }))
    .mutation(({ ctx, input }) => {
      const removed = ctx.providerRegistry.unregister(ctx.db, input.id);
      if (!removed) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Cannot remove built-in provider or provider not found",
        });
      }
      return { success: true };
    }),

  updateProviderArgs: publicProcedure
    .input(z.object({ id: z.string(), args: z.array(z.string()) }))
    .mutation(({ ctx, input }) => {
      const registry = ctx.providerRegistry;
      const provider = registry.get(input.id);
      if (!provider) {
        throw new TRPCError({ code: "NOT_FOUND", message: `Provider ${input.id} not found` });
      }
      // Update args in memory and persist
      provider.args = input.args;
      registry.saveCustomToDb(ctx.db);
      return { success: true };
    }),

  toggleProviderEnabled: publicProcedure
    .input(z.object({ id: z.string(), enabled: z.boolean() }))
    .mutation(({ ctx, input }) => {
      const registry = ctx.providerRegistry;
      const provider = registry.get(input.id);
      if (!provider) {
        throw new TRPCError({ code: "NOT_FOUND", message: `Provider ${input.id} not found` });
      }
      provider.enabled = input.enabled;
      registry.saveCustomToDb(ctx.db);
      return { success: true };
    }),

  swapProviders: publicProcedure
    .input(z.object({ idA: z.string(), idB: z.string() }))
    .mutation(({ ctx, input }) => {
      ctx.providerRegistry.swap(ctx.db, input.idA, input.idB);
      return { success: true };
    }),

  resetProviderArgs: publicProcedure.mutation(({ ctx }) => {
    const registry = ctx.providerRegistry;
    for (const p of registry.list()) {
      p.args = [];
    }
    registry.saveCustomToDb(ctx.db);
    return { success: true };
  }),

  /** T160: set/clear the session alias — the agent_send addressing name. */
  /** Models this account can use with a CLI, from the CLI's own list (empty when it has none) */
  listModels: publicProcedure
    .input(z.object({ cliType: z.string().regex(/^[\w-]{1,40}$/) }))
    .query(({ input }) => listCliModels(input.cliType)),

  /** The model the CLI uses with none given, and where it is set (null when unknown) */
  defaultModel: publicProcedure
    .input(z.object({ cliType: z.string().regex(/^[\w-]{1,40}$/) }))
    .query(({ input }) => cliDefaultModel(input.cliType)),

  /** T104 — Run preflight checks before spawning an agent.
   *  Returns errors (blocking) and warnings (non-blocking) without side effects. */
  preflight: publicProcedure
    .input(
      z.object({
        cliType: z.string(),
        projectId: z.string(),
        useWorktree: z.boolean().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const provider = ctx.providerRegistry.get(input.cliType);
      if (!provider) {
        return {
          ok: false,
          errors: [{ code: "UNKNOWN_CLI", message: `Unknown CLI type: ${input.cliType}` }],
          warnings: [],
        };
      }
      const project = ctx.db
        .prepare("SELECT path FROM projects WHERE id = ?")
        .get(input.projectId) as { path: string } | undefined;
      if (!project) {
        return {
          ok: false,
          errors: [{ code: "PROJECT_NOT_FOUND", message: "Project not found" }],
          warnings: [],
        };
      }
      return runPreflight({
        cliType: input.cliType as Parameters<typeof runPreflight>[0]["cliType"],
        command: resolveCommand(provider.command),
        projectPath: project.path,
        useWorktree: input.useWorktree,
        coreRustLoaded: !!coreRust,
      });
    }),
};
