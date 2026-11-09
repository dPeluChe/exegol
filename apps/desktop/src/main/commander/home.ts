import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Project } from "@exegol/shared";
import type Database from "libsql";
import { createProject, getProject } from "../db/queries/projects";
import { getJsonSetting, setJsonSetting } from "../db/queries/settings";
import { initGitRepo } from "../ipc/procedures/project-folder";
import { COMMANDER_BRIEF } from "./brief";

export const COMMANDER_NAME = "Commander";
const COMMANDER_DIR = join(homedir(), ".exegol", "commander");
const PROJECT_KEY = "commander_project_id";
const AUTONOMY_KEY = "commander_autonomy";

/** answer: it may write into sessions when sure. ask: it only proposes, the person sends */
export type CommanderAutonomy = "answer" | "ask";

export function commanderProjectId(db: Database.Database): string | null {
  const id = getJsonSetting<string | null>(db, PROJECT_KEY, null);
  return id && getProject(db, id) ? id : null;
}

/** The session's project, which the token registry gives: a session cannot claim the role */
export function isCommander(db: Database.Database, context: { projectId: string }): boolean {
  return context.projectId === getJsonSetting<string | null>(db, PROJECT_KEY, null);
}

export const commanderAutonomy = (db: Database.Database): CommanderAutonomy =>
  getJsonSetting<CommanderAutonomy>(db, AUTONOMY_KEY, "answer") === "ask" ? "ask" : "answer";

export function setCommanderAutonomy(db: Database.Database, value: CommanderAutonomy): void {
  setJsonSetting(db, AUTONOMY_KEY, value);
}

/** Its own project in a folder Exegol owns: the brief is rewritten on every start */
export async function ensureCommanderHome(db: Database.Database, dir = COMMANDER_DIR) {
  await mkdir(dir, { recursive: true });
  // One brief under the name each CLI reads
  await Promise.all(
    ["CLAUDE.md", "AGENTS.md", "GEMINI.md"].map((file) =>
      writeFile(join(dir, file), COMMANDER_BRIEF),
    ),
  );
  // The Git pane and status polls expect a repo; without git the folder still works
  if (!existsSync(join(dir, ".git"))) await initGitRepo(dir, "main").catch(() => {});
  const known = commanderProjectId(db);
  if (known) return getProject(db, known) as Project;
  const project = createProject(db, {
    name: COMMANDER_NAME,
    path: dir,
    gitRemote: null,
    defaultBranch: "main",
  });
  setJsonSetting(db, PROJECT_KEY, project.id);
  return project;
}
