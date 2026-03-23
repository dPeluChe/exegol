import type { SkillInstallResult, SkillLockFile, SkillRegistryEntry } from "@exegol/shared";
import { z } from "zod";
import { getRegistryEntries } from "../../skills/curated-registry";
import { importSkills, scanForImportCandidates } from "../../skills/importer";
import { installFromGitHub, readLockFile, uninstallSkill } from "../../skills/installer";
import { getCanonicalSkillsDir, getProjectSkillsDir } from "../../skills/paths";
import { publicProcedure, router } from "../trpc";

export const skillInstallerRouter = router({
  install: publicProcedure
    .input(
      z.object({
        repo: z.string(),
        scope: z.enum(["global", "project"]),
        projectPath: z.string().optional(),
      }),
    )
    .mutation(async ({ input }): Promise<SkillInstallResult> => {
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
        skillName: z.string(),
        scope: z.enum(["global", "project"]),
        projectPath: z.string().optional(),
      }),
    )
    .mutation(({ input }): boolean => {
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
