import { stat } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute } from "node:path";
import { TRPCError } from "@trpc/server";
import { shell } from "electron";
import { z } from "zod";
import { stripAnsi } from "../../agents/status-parser";
import { getAgentCwd } from "../../db/queries/agents";
import { resolveLinkPath } from "../../lib/link-paths";
import { isPathAllowed } from "../../security/path-guard";
import { publicProcedure, router } from "../trpc";
import { openWithSystemApp, readForViewer } from "./files";
import { allowedBases } from "./project-paths";
import { readSessionOutput } from "./scrollback";

type Ctx = { db: import("libsql").Database };

const linkInput = z.object({
  agentId: z.string().regex(/^[a-zA-Z0-9_-]+$/),
  /** The shell's cwd from OSC 7 when it moved; else the agent's worktree or project */
  cwd: z.string().max(4096).optional(),
});
const linkText = z.string().min(1).max(1024);

/**
 * A terminal link may show a file inside a project, or one outside that this session printed
 * (the user saw it there). Anything else is refused: the renderer only names what it clicked.
 * Built once per call: the bases, the cwd and (only if an outside path needs it) the output.
 */
function linkAccess(ctx: Ctx, input: z.infer<typeof linkInput>) {
  const cwd = input.cwd && isAbsolute(input.cwd) ? input.cwd : getAgentCwd(ctx.db, input.agentId);
  const bases = allowedBases(ctx);
  let output: string | null | undefined;
  return async (text: string): Promise<{ path: string; inside: boolean } | null> => {
    if (!cwd) return null;
    const path = resolveLinkPath(text, cwd, homedir());
    if (await isPathAllowed(path, bases)) return { path, inside: true };
    if (output === undefined) {
      const raw = readSessionOutput(input.agentId);
      output = raw ? stripAnsi(raw) : null;
    }
    return output?.includes(text) ? { path, inside: false } : null;
  };
}

async function requireAccess(ctx: Ctx, input: z.infer<typeof linkInput> & { text: string }) {
  const access = await linkAccess(ctx, input)(input.text);
  if (!access) throw new TRPCError({ code: "FORBIDDEN", message: "Not a link this session shows" });
  return access;
}

export const terminalLinksRouter = router({
  /** One call per terminal viewport: which printed paths are files, and where they are */
  resolve: publicProcedure
    .input(linkInput.extend({ texts: z.array(linkText).max(300) }))
    .query(async ({ ctx, input }) => {
      const access = linkAccess(ctx, input);
      return Promise.all(
        input.texts.map(async (text) => {
          try {
            const found = await access(text);
            if (!found || !(await stat(found.path)).isFile()) return { text, path: null };
            return { text, path: found.path };
          } catch {
            return { text, path: null };
          }
        }),
      );
    }),

  /** Read-only: a link never writes, inside a project or not */
  read: publicProcedure
    .input(linkInput.extend({ text: linkText }))
    .query(async ({ ctx, input }) => {
      const { path, inside } = await requireAccess(ctx, input);
      return { ...(await readForViewer(path, { svgAsImage: true })), path, inside };
    }),

  open: publicProcedure
    .input(linkInput.extend({ text: linkText, how: z.enum(["reveal", "external"]) }))
    .mutation(async ({ ctx, input }) => {
      const { path } = await requireAccess(ctx, input);
      if (input.how === "reveal") {
        shell.showItemInFolder(path);
        return { opened: false, revealed: true };
      }
      return openWithSystemApp(path);
    }),
});
