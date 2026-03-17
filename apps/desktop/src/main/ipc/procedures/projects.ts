import { z } from 'zod'
import { TRPCError } from '@trpc/server'
import { existsSync, statSync } from 'fs'
import { execFile } from 'child_process'
import { promisify } from 'util'

const execFileAsync = promisify(execFile)
import {
  listProjects,
  getProject,
  createProject,
  deleteProject,
  updateProjectLastOpened,
} from '../../db/queries'
import { projectCreateSchema } from '@exegol/shared'
import { router, publicProcedure } from '../trpc'

async function isGitRepo(path: string): Promise<boolean> {
  try {
    await execFileAsync('git', ['rev-parse', '--is-inside-work-tree'], {
      cwd: path,
    })
    return true
  } catch {
    return false
  }
}

async function getGitRemote(path: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync('git', ['config', '--get', 'remote.origin.url'], {
      cwd: path,
    })
    const remote = stdout.trim()
    return remote || null
  } catch {
    return null
  }
}

export const projectRouter = router({
  list: publicProcedure.query(({ ctx }) => {
    return listProjects(ctx.db)
  }),

  get: publicProcedure.input(z.object({ id: z.string() })).query(({ ctx, input }) => {
    const project = getProject(ctx.db, input.id)
    if (!project) {
      throw new TRPCError({ code: 'NOT_FOUND', message: `Project ${input.id} not found` })
    }
    return project
  }),

  create: publicProcedure.input(projectCreateSchema).mutation(async ({ ctx, input }) => {
    if (!existsSync(input.path)) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: `Path does not exist: ${input.path}`,
      })
    }

    const stats = statSync(input.path)
    if (!stats.isDirectory()) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: `Path is not a directory: ${input.path}`,
      })
    }

    if (!(await isGitRepo(input.path))) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: `Path is not a git repository: ${input.path}`,
      })
    }

    const gitRemote = input.gitRemote ?? (await getGitRemote(input.path))

    return createProject(ctx.db, {
      ...input,
      gitRemote,
    })
  }),

  delete: publicProcedure.input(z.object({ id: z.string() })).mutation(({ ctx, input }) => {
    const project = getProject(ctx.db, input.id)
    if (!project) {
      throw new TRPCError({ code: 'NOT_FOUND', message: `Project ${input.id} not found` })
    }
    deleteProject(ctx.db, input.id)
    return { success: true }
  }),

  open: publicProcedure.input(z.object({ id: z.string() })).mutation(({ ctx, input }) => {
    const project = getProject(ctx.db, input.id)
    if (!project) {
      throw new TRPCError({ code: 'NOT_FOUND', message: `Project ${input.id} not found` })
    }
    updateProjectLastOpened(ctx.db, input.id)
    return getProject(ctx.db, input.id)!
  }),
})
