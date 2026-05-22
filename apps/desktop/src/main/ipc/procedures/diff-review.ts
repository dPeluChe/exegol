import { extname } from "node:path";
import { getProjectPorts } from "../../system/ports";
import { execFileAsync } from "./diff-helpers";

const SENSITIVE_PATTERNS = [
  /\.env($|\.)/,
  /credentials/i,
  /secret/i,
  /\.pem$/,
  /\.key$/,
  /\.p12$/,
  /\.pfx$/,
  /id_rsa/,
  /\.keystore$/,
];

const BINARY_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".ico",
  ".webp",
  ".svg",
  ".woff",
  ".woff2",
  ".ttf",
  ".eot",
  ".zip",
  ".tar",
  ".gz",
  ".bz2",
  ".exe",
  ".dll",
  ".so",
  ".dylib",
  ".wasm",
  ".pdf",
  ".mp4",
  ".mp3",
]);

const DEP_FILES = new Set([
  "package.json",
  "package-lock.json",
  "bun.lockb",
  "yarn.lock",
  "pnpm-lock.yaml",
  "Cargo.toml",
  "Cargo.lock",
  "go.mod",
  "go.sum",
  "requirements.txt",
  "Pipfile.lock",
  "poetry.lock",
  "Gemfile.lock",
  "composer.lock",
]);

const TEST_PATTERNS = [
  /\.test\.[jt]sx?$/,
  /\.spec\.[jt]sx?$/,
  /__tests__\//,
  /test\//i,
  /\.cy\.[jt]sx?$/, // Cypress
];

interface ReviewSignal {
  type: "info" | "warn" | "risk";
  label: string;
  detail?: string;
}

interface ReviewSummary {
  totalFiles: number;
  filesByType: Record<string, number>;
  signals: ReviewSignal[];
  additions: number;
  deletions: number;
}

export async function buildReviewSummary(cwd: string, staged?: boolean): Promise<ReviewSummary> {
  const signals: ReviewSignal[] = [];
  const filesByType: Record<string, number> = {};

  // Get changed files from git status
  let statusFiles: string[] = [];
  try {
    const { stdout } = await execFileAsync("git", ["status", "--porcelain=v1", "-uall"], {
      cwd,
      maxBuffer: 1024 * 1024,
    });
    statusFiles = stdout
      .split("\n")
      .filter(Boolean)
      .map((line) => line.slice(3));
  } catch {
    return {
      totalFiles: 0,
      filesByType,
      signals: [{ type: "warn", label: "Could not read git status" }],
      additions: 0,
      deletions: 0,
    };
  }

  if (statusFiles.length === 0) {
    return { totalFiles: 0, filesByType, signals, additions: 0, deletions: 0 };
  }

  // Classify files
  const sensitiveFiles: string[] = [];
  const binaryFiles: string[] = [];
  const depFiles: string[] = [];
  const testFiles: string[] = [];

  for (const filePath of statusFiles) {
    const ext = extname(filePath).toLowerCase() || "(no ext)";
    filesByType[ext] = (filesByType[ext] ?? 0) + 1;

    const baseName = filePath.split("/").pop() ?? filePath;

    if (SENSITIVE_PATTERNS.some((p) => p.test(filePath))) sensitiveFiles.push(filePath);
    if (BINARY_EXTENSIONS.has(ext)) binaryFiles.push(filePath);
    if (DEP_FILES.has(baseName)) depFiles.push(filePath);
    if (TEST_PATTERNS.some((p) => p.test(filePath))) testFiles.push(filePath);
  }

  // Fetch diff stats + ports in parallel (both non-fatal)
  const diffArgs = staged ? ["diff", "--cached", "--shortstat"] : ["diff", "--shortstat"];
  const [diffStat, ports] = await Promise.all([
    execFileAsync("git", diffArgs, { cwd, maxBuffer: 64 * 1024 })
      .then(({ stdout }) => stdout)
      .catch(() => ""),
    getProjectPorts(cwd).catch(() => []),
  ]);

  let additions = 0;
  let deletions = 0;
  const addMatch = diffStat.match(/(\d+) insertion/);
  const delMatch = diffStat.match(/(\d+) deletion/);
  if (addMatch?.[1]) additions = Number.parseInt(addMatch[1], 10);
  if (delMatch?.[1]) deletions = Number.parseInt(delMatch[1], 10);

  // Build risk signals
  if (sensitiveFiles.length > 0) {
    signals.push({
      type: "risk",
      label: `${sensitiveFiles.length} sensitive file(s)`,
      detail: sensitiveFiles.join(", "),
    });
  }
  if (depFiles.length > 0) {
    signals.push({ type: "warn", label: `Dependency changes: ${depFiles.join(", ")}` });
  }
  if (binaryFiles.length > 0) {
    signals.push({
      type: "warn",
      label: `${binaryFiles.length} binary/asset file(s)`,
      detail: binaryFiles.join(", "),
    });
  }
  if (testFiles.length > 0) {
    signals.push({ type: "info", label: `${testFiles.length} test file(s) modified` });
  } else if (statusFiles.length > 3) {
    signals.push({ type: "warn", label: "No test files in this changeset" });
  }
  if (statusFiles.length > 20) {
    signals.push({ type: "warn", label: `Large changeset: ${statusFiles.length} files` });
  }

  const runtimePorts = ports.filter((p) => p.source === "runtime");
  if (runtimePorts.length > 0) {
    signals.push({
      type: "info",
      label: `${runtimePorts.length} open port(s): ${runtimePorts.map((p) => p.port).join(", ")}`,
    });
  }

  return { totalFiles: statusFiles.length, filesByType, signals, additions, deletions };
}
