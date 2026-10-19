import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { app, dialog } from "electron";
import type Database from "libsql";
import { HOOKS_DIR } from "../agents/wrappers";
import { listLiveAgentFolders } from "../db/queries/agents";
import { listProjects } from "../db/queries/projects";
import { logger } from "../lib/logger";
import { relocateMcpConfigs } from "../mcp/exegol-mcp-config";
import {
  bundleRoot,
  isTransientLocation,
  planRelocation,
  shouldOfferMove,
  swapRoot,
} from "./app-location";
import { relocateCliLink } from "./cli-installer";

/** Where the last packaged launch ran from */
const RECORD = join(homedir(), ".exegol", "app-location.json");

function lastExecPath(): string | null {
  try {
    const parsed = JSON.parse(readFileSync(RECORD, "utf-8")) as { execPath?: unknown };
    return typeof parsed.execPath === "string" ? parsed.execPath : null;
  } catch {
    return null;
  }
}

/** Per-agent hook settings (`--settings`) name the app for the claim guard */
function relocateHooks(swap: <T>(value: T) => T): number {
  if (!existsSync(HOOKS_DIR)) return 0;
  let changed = 0;
  for (const name of readdirSync(HOOKS_DIR).filter((n) => n.endsWith(".json"))) {
    const path = join(HOOKS_DIR, name);
    try {
      const before = JSON.parse(readFileSync(path, "utf-8"));
      const after = swap(before);
      if (JSON.stringify(after) === JSON.stringify(before)) continue;
      writeFileSync(path, JSON.stringify(after, null, 2), "utf-8");
      changed++;
    } catch {
      /* a file that does not parse stays as it is */
    }
  }
  return changed;
}

/** Files that outlive a launch name the app (MCP configs, hook settings, the codex block, the CLI
 *  link): after a move they follow it. Packaged only: dev and a packaged build alternating would
 *  flip them on every launch */
export function relocateAppPaths(db: Database.Database): void {
  if (!app.isPackaged) return;
  const execPath = process.execPath;
  if (isTransientLocation(execPath)) {
    logger.warn(
      `[ExecPath] running from ${bundleRoot(execPath)}: agent configs written now break once it moves; install Exegol to Applications`,
    );
  }
  try {
    const move = planRelocation(lastExecPath(), execPath);
    if (move) {
      const swap = <T>(value: T): T => swapRoot(value, move);
      const folders = [...listProjects(db).map((p) => p.path), ...listLiveAgentFolders(db)];
      const n = relocateMcpConfigs(folders, swap) + relocateHooks(swap) + relocateCliLink(swap);
      logger.info(`[ExecPath] moved ${move.from} -> ${move.to}: rewrote ${n} file(s)`);
    }
    writeFileSync(RECORD, `${JSON.stringify({ execPath })}\n`, "utf-8");
  } catch (err) {
    logger.warn("[ExecPath] relocation failed:", err);
  }
}

/** Off a DMG or translocated: offer the move once per launch (the app relaunches from there) */
export async function offerMoveToApplications(): Promise<void> {
  const offer = shouldOfferMove({
    platform: process.platform,
    packaged: app.isPackaged,
    execPath: process.execPath,
    inApplications: process.platform === "darwin" && app.isInApplicationsFolder(),
  });
  if (!offer) return;
  const { response } = await dialog.showMessageBox({
    type: "question",
    buttons: ["Move to Applications", "Not Now"],
    defaultId: 0,
    cancelId: 1,
    message: "Move Exegol to Applications?",
    detail:
      "Exegol is running from the disk image. Agent hooks and MCP configs point at the app, so they break once the disk image is ejected.",
  });
  if (response !== 0) return;
  try {
    app.moveToApplicationsFolder();
  } catch (err) {
    logger.warn("[ExecPath] move to Applications failed:", err);
  }
}
