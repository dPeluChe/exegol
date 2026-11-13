import { COLAB_NAME_MAX, COLAB_PURPOSE_MAX, COLAB_ROLE_MAX } from "@exegol/shared";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  addColabMember,
  createColab,
  deleteColab,
  listColabs,
  removeColabMember,
  setColabMain,
  setColabMemberRole,
  updateColab,
} from "../../db/queries/colabs";
import { countColabActiveThreads } from "../../db/queries/inbox";
import { getProject } from "../../db/queries/projects";
import { notifyInboxChanged } from "../../inbox/threads";
import { publicProcedure, router } from "../trpc";

const fields = z.object({
  name: z.string().trim().min(1).max(COLAB_NAME_MAX),
  purpose: z.string().trim().max(COLAB_PURPOSE_MAX),
});
const member = z.object({
  colabId: z.string(),
  projectId: z.string(),
  repo: z.string().max(500),
});

/** The one constraint a person can hit */
function uniqueName<T>(run: () => T): T {
  try {
    return run();
  } catch (err) {
    if (String(err).includes("UNIQUE")) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "A colab with that name exists" });
    }
    throw err;
  }
}

function changed<T>(out: T): T {
  notifyInboxChanged();
  return out;
}

/** Only the person changes colabs: these procedures, never an MCP tool */
export const colabsRouter = router({
  list: publicProcedure.query(({ ctx }) => listColabs(ctx.db)),

  create: publicProcedure
    .input(fields.extend({ firstMember: z.string().nullish() }))
    .mutation(({ ctx, input }) => {
      const first =
        input.firstMember && getProject(ctx.db, input.firstMember) ? input.firstMember : null;
      return changed(
        uniqueName(() => ({ id: createColab(ctx.db, input.name, input.purpose, first) })),
      );
    }),

  update: publicProcedure
    .input(fields.extend({ id: z.string() }))
    .mutation(({ ctx, input }) =>
      changed(uniqueName(() => updateColab(ctx.db, input.id, input.name, input.purpose))),
    ),

  delete: publicProcedure.input(z.object({ id: z.string() })).mutation(({ ctx, input }) => {
    const active = countColabActiveThreads(ctx.db, input.id);
    if (active > 0) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `It has ${active} open thread${active === 1 ? "" : "s"}: close them first`,
      });
    }
    return changed(deleteColab(ctx.db, input.id));
  }),

  addMember: publicProcedure
    .input(member.extend({ role: z.string().trim().max(COLAB_ROLE_MAX) }))
    .mutation(({ ctx, input }) => {
      if (!getProject(ctx.db, input.projectId)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "No such project" });
      }
      const { colabId, projectId, repo, role } = input;
      return changed(addColabMember(ctx.db, colabId, { projectId, repo, role }));
    }),

  setRole: publicProcedure
    .input(member.extend({ role: z.string().trim().max(COLAB_ROLE_MAX) }))
    .mutation(({ ctx, input }) => {
      const { colabId, projectId, repo, role } = input;
      return changed(setColabMemberRole(ctx.db, colabId, { projectId, repo, role }));
    }),

  setMain: publicProcedure
    .input(member)
    .mutation(({ ctx, input }) =>
      changed(setColabMain(ctx.db, input.colabId, input.projectId, input.repo)),
    ),

  removeMember: publicProcedure
    .input(member)
    .mutation(({ ctx, input }) =>
      changed(removeColabMember(ctx.db, input.colabId, input.projectId, input.repo)),
    ),
});
