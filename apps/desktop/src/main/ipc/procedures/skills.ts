import type { SkillWithState } from "@exegol/shared";
import { z } from "zod";
import { listSkillStates, setSkillEnabled } from "../../db/queries/skills";
import { discoverSkills } from "../../skills/discovery";
import { publicProcedure, router } from "../trpc";

export const skillsRouter = router({
  /**
   * List all discovered skills with their enabled/disabled state for a project.
   */
  list: publicProcedure
    .input(z.object({ projectId: z.string(), projectPath: z.string().nullable() }))
    .query(({ ctx, input }): SkillWithState[] => {
      const skills = discoverSkills(input.projectPath);
      const states = listSkillStates(ctx.db, input.projectId);
      const stateMap = new Map(states.map((s) => [s.skillName, s.enabled]));

      return skills.map((skill) => ({
        ...skill,
        // Default to enabled if no explicit state in DB
        enabled: stateMap.get(skill.name) ?? true,
      }));
    }),

  /**
   * Toggle a skill's enabled/disabled state for a project.
   */
  toggle: publicProcedure
    .input(
      z.object({
        projectId: z.string(),
        skillName: z.string(),
        enabled: z.boolean(),
      }),
    )
    .mutation(({ ctx, input }) => {
      return setSkillEnabled(ctx.db, input.projectId, input.skillName, input.enabled);
    }),

  /**
   * Get the content of a specific skill by name (for preview).
   */
  getContent: publicProcedure
    .input(z.object({ projectPath: z.string().nullable(), skillName: z.string() }))
    .query(({ input }): string | null => {
      const skills = discoverSkills(input.projectPath);
      const skill = skills.find((s) => s.name === input.skillName);
      return skill?.content ?? null;
    }),

  /**
   * Get enabled skills ready for injection into agent context.
   */
  getEnabledForSpawn: publicProcedure
    .input(z.object({ projectId: z.string(), projectPath: z.string().nullable() }))
    .query(({ ctx, input }): SkillWithState[] => {
      const skills = discoverSkills(input.projectPath);
      const states = listSkillStates(ctx.db, input.projectId);
      const stateMap = new Map(states.map((s) => [s.skillName, s.enabled]));

      return skills
        .filter((s) => s.available)
        .filter((s) => stateMap.get(s.name) ?? true)
        .map((s) => ({ ...s, enabled: true }));
    }),
});
