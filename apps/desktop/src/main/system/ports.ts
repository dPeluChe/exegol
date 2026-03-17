import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface DetectedPort {
  port: number;
  pid: number;
  process: string;
  source: "runtime";
}

export interface ConfiguredPort {
  port: number;
  source: "config";
  file: string;
}

export type PortInfo = DetectedPort | ConfiguredPort;

/** Resolve the CWD for a given PID. Returns null if it can't be determined. */
async function getProcessCwd(pid: number): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync("lsof", ["-p", String(pid), "-Fn"], {
      timeout: 3000,
    });
    // lsof -Fn outputs lines like "fcwd\nn/path/to/dir" — find the cwd entry
    const lines = stdout.split("\n");
    for (let i = 0; i < lines.length; i++) {
      if (lines[i] === "fcwd") {
        const next = lines[i + 1];
        if (next?.startsWith("n")) return next.slice(1);
      }
    }
  } catch {
    // Process may have exited
  }
  return null;
}

/** Detect active listening TCP ports, filtered to those whose CWD is under projectPath */
async function detectListeningPorts(projectPath: string): Promise<DetectedPort[]> {
  try {
    const { stdout } = await execFileAsync("lsof", ["-iTCP", "-sTCP:LISTEN", "-P", "-n"], {
      timeout: 5000,
    });

    const lines = stdout.split("\n").slice(1); // skip header
    const candidates: { port: number; pid: number; process: string }[] = [];
    const seen = new Set<string>();

    for (const line of lines) {
      const parts = line.trim().split(/\s+/);
      if (parts.length < 9) continue;

      const processName = parts[0] ?? "";
      const pid = Number.parseInt(parts[1] ?? "0", 10);
      const nameCol = parts[parts.length - 1] ?? "";
      const portMatch = nameCol.match(/:(\d+)$/);
      if (!portMatch?.[1]) continue;

      const port = Number.parseInt(portMatch[1], 10);
      const key = `${pid}:${port}`;
      if (seen.has(key)) continue;
      seen.add(key);

      candidates.push({ port, pid, process: processName });
    }

    // Resolve CWDs in parallel and filter to those under projectPath
    const cwdChecks = await Promise.all(
      candidates.map(async (c) => {
        const cwd = await getProcessCwd(c.pid);
        return { ...c, cwd };
      }),
    );

    return cwdChecks
      .filter((c) => c.cwd?.startsWith(projectPath))
      .map(({ port, pid, process: proc }) => ({
        port,
        pid,
        process: proc,
        source: "runtime" as const,
      }));
  } catch {
    return [];
  }
}

function parsePortFromMatch(match: RegExpMatchArray | null, index: number): number | null {
  const val = match?.[index];
  if (!val) return null;
  const n = Number.parseInt(val, 10);
  return n > 0 && n <= 65535 ? n : null;
}

/** Parse common config files for expected port numbers */
async function parseConfigPorts(projectPath: string): Promise<ConfiguredPort[]> {
  const ports: ConfiguredPort[] = [];
  const seen = new Set<number>();

  const addPort = (port: number | null, file: string) => {
    if (port && !seen.has(port)) {
      seen.add(port);
      ports.push({ port, source: "config", file });
    }
  };

  // package.json scripts: --port NNNN or -p NNNN
  try {
    const raw = await readFile(join(projectPath, "package.json"), "utf-8");
    const pkg = JSON.parse(raw);
    if (pkg.scripts) {
      for (const script of Object.values(pkg.scripts)) {
        const matches = (script as string).match(/(?:--port|-p)\s+(\d+)/g);
        if (matches) {
          for (const m of matches) {
            addPort(parsePortFromMatch(m.match(/(\d+)/), 1), "package.json");
          }
        }
      }
    }
  } catch {
    /* no package.json */
  }

  // .env and .env.local: PORT=NNNN
  for (const envFile of [".env", ".env.local"]) {
    try {
      const raw = await readFile(join(projectPath, envFile), "utf-8");
      addPort(parsePortFromMatch(raw.match(/^PORT\s*=\s*(\d+)/m), 1), envFile);
    } catch {
      /* file doesn't exist */
    }
  }

  // vite.config.ts/js: server: { port: NNNN }
  for (const viteFile of ["vite.config.ts", "vite.config.js"]) {
    try {
      const raw = await readFile(join(projectPath, viteFile), "utf-8");
      addPort(parsePortFromMatch(raw.match(/port\s*:\s*(\d+)/), 1), viteFile);
    } catch {
      /* file doesn't exist */
    }
  }

  // next.config.js/mjs
  for (const nextFile of ["next.config.js", "next.config.mjs"]) {
    try {
      const raw = await readFile(join(projectPath, nextFile), "utf-8");
      addPort(parsePortFromMatch(raw.match(/port\s*[=:]\s*(\d+)/), 1), nextFile);
    } catch {
      /* file doesn't exist */
    }
  }

  return ports;
}

/** Get all ports for a project — both runtime and configured */
export async function getProjectPorts(projectPath: string): Promise<PortInfo[]> {
  const [runtime, config] = await Promise.all([
    detectListeningPorts(projectPath),
    parseConfigPorts(projectPath),
  ]);

  return [...runtime, ...config];
}
