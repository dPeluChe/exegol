import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  COMMANDER_VOICE_KEY,
  type CommanderVoiceSettings,
  DEFAULT_COMMANDER_VOICE,
  type Project,
  SPEECH_SPEED_MAX,
  SPEECH_SPEED_MIN,
} from "@exegol/shared";
import type Database from "libsql";
import { createProject, getProject } from "../db/queries/projects";
import { getJsonSetting, setJsonSetting } from "../db/queries/settings";
import { initGitRepo } from "../ipc/procedures/project-folder";
import { COMMANDER_BRIEF } from "./brief";
import { COMMANDER_DIR } from "./dir";

export const COMMANDER_NAME = "Commander";
const PROJECT_KEY = "commander_project_id";
const AUTONOMY_KEY = "commander_autonomy";
const FEED_KEY = "commander_feed";

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

/** On: Exegol tells it what changed in the fleet, so it reports without being asked */
export const commanderFeed = (db: Database.Database): boolean =>
  getJsonSetting<boolean>(db, FEED_KEY, true) !== false;

export function setCommanderFeed(db: Database.Database, on: boolean): void {
  setJsonSetting(db, FEED_KEY, on);
}

/** Its replies read aloud: on click, or each new one when `auto` */
export function commanderVoice(db: Database.Database): CommanderVoiceSettings {
  const saved = getJsonSetting<Partial<CommanderVoiceSettings> | null>(
    db,
    COMMANDER_VOICE_KEY,
    null,
  );
  const speed = Number(saved?.speed);
  return {
    auto: saved?.auto === true,
    voice: typeof saved?.voice === "string" ? saved.voice : DEFAULT_COMMANDER_VOICE.voice,
    speed: Number.isFinite(speed)
      ? Math.min(SPEECH_SPEED_MAX, Math.max(SPEECH_SPEED_MIN, speed))
      : DEFAULT_COMMANDER_VOICE.speed,
  };
}

export function setCommanderVoice(
  db: Database.Database,
  patch: Partial<CommanderVoiceSettings>,
): CommanderVoiceSettings {
  const next = { ...commanderVoice(db), ...patch };
  setJsonSetting(db, COMMANDER_VOICE_KEY, next);
  return commanderVoice(db);
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
