import type { SkillInstallResult, SkillLockFile, SkillRegistryEntry } from "@exegol/shared";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { getRegistryEntries } from "../../skills/curated-registry";
import { importSkills, scanForImportCandidates } from "../../skills/importer";
import { installFromGitHub, readLockFile, uninstallSkill } from "../../skills/installer";
import { getCanonicalSkillsDir, getProjectSkillsDir } from "../../skills/paths";
import { publicProcedure, router } from "../trpc";
import { assertPathInsideProject } from "./project-paths";

/** A project-scoped skill needs its project, inside a registered one: without it the global
 *  skill of the same name was the one uninstalled */
async function assertProjectScope(
  input: { scope: "global" | "project"; projectPath?: string },
  ctx: { db: import("libsql").Database },
): Promise<void> {
  if (input.scope !== "project") return;
  if (!input.projectPath) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "A project skill needs its project path" });
  }
  await assertPathInsideProject(input.projectPath, ctx);
}

export const skillInstallerRouter = router({
  install: publicProcedure
    .input(
      z.object({
        repo: z.string(),
        scope: z.enum(["global", "project"]),
        projectPath: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }): Promise<SkillInstallResult> => {
      await assertProjectScope(input, ctx);
      return installFromGitHub(input);
    }),

  registry: publicProcedure.query((): SkillRegistryEntry[] => {
    return getRegistryEntries();
  }),

  lockFile: publicProcedure
    .input(
      z.object({
        scope: z.enum(["global", "project"]),
        projectPath: z.string().optional(),
      }),
    )
    .query(({ input }): SkillLockFile => {
      const dir =
        input.scope === "project" && input.projectPath
          ? getProjectSkillsDir(input.projectPath)
          : getCanonicalSkillsDir();
      return readLockFile(dir);
    }),

  uninstall: publicProcedure
    .input(
      z.object({
        // A folder name, never a path: it goes into rmSync(recursive)
        skillName: z.string().regex(/^[\w][\w.-]*$/),
        scope: z.enum(["global", "project"]),
        projectPath: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }): Promise<boolean> => {
      await assertProjectScope(input, ctx);
      return uninstallSkill(input.skillName, input.scope, input.projectPath);
    }),

  scanImports: publicProcedure.query(() => {
    return scanForImportCandidates();
  }),

  importSelected: publicProcedure
    .input(
      z.object({
        skills: z.array(
          z.object({
            agent: z.string(),
            sourcePath: z.string(),
            name: z.string(),
          }),
        ),
        force: z.boolean().optional(),
      }),
    )
    .mutation(({ input }): SkillInstallResult => {
      return importSkills(input.skills, { force: input.force });
    }),
});
