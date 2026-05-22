import { realpath } from "node:fs/promises";
import { basename, isAbsolute, join, relative, resolve, sep } from "node:path";

/**
 * Returns true if `target` is inside `base` (or equal to it).
 *
 * Uses `relative()` so a base of `/repo/app` never matches `/repo/app-evil`
 * (startsWith would allow that prefix).
 */
export function isPathInside(base: string, target: string): boolean {
  const rel = relative(base, target);
  return !rel.startsWith("..") && !isAbsolute(rel);
}

/**
 * Resolves symlinks by walking up to the nearest existing ancestor.
 * This handles both symlinked base paths (e.g. macOS /tmp → /private/tmp)
 * and non-existent targets (files about to be created).
 */
export async function realpathSafe(p: string): Promise<string> {
  const abs = resolve(p);
  let current = abs;
  const missing: string[] = [];

  while (true) {
    try {
      const real = await realpath(current);
      return missing.length ? join(real, ...missing.reverse()) : real;
    } catch {
      const parent = resolve(current, "..");
      if (parent === current) return abs; // hit filesystem root — give up
      missing.push(current.slice(parent.length + 1));
      current = parent;
    }
  }
}

/**
 * Checks that `filePath` resolves to a location inside one of the `allowedBases`.
 * Returns true if allowed, false if denied.
 *
 * Both the target and each base are realpath-resolved to defeat symlink traversal.
 */
export async function isPathAllowed(filePath: string, allowedBases: string[]): Promise<boolean> {
  const target = await realpathSafe(filePath);
  for (const base of allowedBases) {
    const resolvedBase = await realpathSafe(base);
    if (isPathInside(resolvedBase, target)) return true;
  }
  return false;
}

// ─── New defense-in-depth helpers (T117) ─────────────────────────────────────

/**
 * Reasons a path can be refused by {@link assertSafePath}. Exhaustive so callers
 * can switch over them.
 */
export type PathGuardReason =
  | "bidi-chars"
  | "ads-suffix"
  | "sensitive-path"
  | "outside-allowed-bases";

export class PathGuardError extends Error {
  readonly reason: PathGuardReason;
  readonly path: string;
  constructor(reason: PathGuardReason, path: string, message: string) {
    super(message);
    this.name = "PathGuardError";
    this.reason = reason;
    this.path = path;
  }
}

// Unicode bidirectional formatting characters used in Trojan Source attacks.
// U+202A–U+202E covers LRE/RLE/PDF/LRO/RLO; U+2066–U+2069 covers LRI/RLI/FSI/PDI;
// U+200E/U+200F (LRM/RLM) and U+061C (ALM) are the directional marks. Any of
// these in a filename or command can visually reorder text in a reviewer's
// terminal or editor, hiding the real intent.
const BIDI_CHAR_RE = /[‪-‮⁦-⁩‎‏؜]/u;

export function hasBidiChars(name: string): boolean {
  return BIDI_CHAR_RE.test(name);
}

// NTFS Alternate Data Streams: `file.txt:hidden_stream` opens `file.txt` but
// hides the stream content. Strip the Windows drive-letter prefix (`C:`) and
// reject any other `:` in the path. Only meaningful on Windows; gated on
// platform so legitimate POSIX filenames containing `:` (ISO-8601 timestamps,
// Time Machine metadata, etc.) are not refused on macOS/Linux.
const DRIVE_PREFIX_RE = /^[a-zA-Z]:/;
const IS_WIN32 = process.platform === "win32";

export function hasAdsSuffix(name: string): boolean {
  if (!IS_WIN32) return false;
  const noDrive = name.replace(DRIVE_PREFIX_RE, "");
  return noDrive.includes(":");
}

// Sensitive basename patterns — match by exact name or `.env.*` suffix, etc.
// Anchored to start-of-basename so a benign `logs/.envcheck.log` is allowed
// while `.env.local` is refused.
const SENSITIVE_BASENAME_RE: RegExp[] = [
  /^\.env(\..+)?$/i, // .env, .env.local, .env.production
  /^\.netrc$/i,
  /^\.npmrc$/i,
  /^\.pgpass$/i,
  /^\.pypirc$/i,
  /^\.gitconfig$/i, // may contain http.<url>.extraheader PAT tokens
  /^\.dockercfg$/i,
  /^\.terraformrc$/i,
  /^id_(rsa|dsa|ecdsa|ed25519)([._-].*)?$/i,
  /^authorized_keys$/i,
  /^known_hosts$/i,
  /^credentials$/i, // .aws/credentials, gcloud, etc.
  /^secrets?\.(json|ya?ml|toml|env)$/i,
  /^service[-_]?account.*\.json$/i, // GCP service-account keys
  /^client[-_]?secret.*\.json$/i, // OAuth client secrets
  /^.+\.pem$/i,
  /^.+\.key$/i,
  /^.+\.p12$/i,
  /^.+\.pfx$/i,
  /^.+\.asc$/i, // PGP armored keys
  /^.+\.gpg$/i,
  /^.+\.keystore$/i,
  /^.+\.jks$/i,
];

// Sensitive directory segments — matched as `/segment/` against the
// normalized comparison surface so `.sshx` does not collide with `.ssh`.
// Path-segment matching also catches the macOS Keychain dir under any user
// home (`/Users/<me>/Library/Keychains/...` lowercase contains
// `/library/keychains/`) without needing absolute-prefix logic.
const SENSITIVE_DIR_SEGMENTS: string[] = [
  ".ssh",
  ".gnupg",
  ".aws",
  ".azure",
  ".kube",
  ".docker",
  ".gcloud",
  ".cargo", // ~/.cargo/credentials (crates.io tokens)
  ".config/gh",
  ".config/gcloud",
  ".config/op",
  ".config/git", // git-credential store
  "library/keychains", // macOS Keychain
  "library/cookies", // macOS / Safari cookies
];

// Absolute-path-prefix sensitive dirs (root profile, system var dirs).
// Matched with startsWith only — interior occurrences would refuse legitimate
// projects that happen to live under directories with these names.
const SENSITIVE_PATH_PREFIXES: string[] = [
  "/private/var/db/",
  "/private/var/root/",
  "/var/db/",
  "/var/root/",
];

function normalizeForCompare(p: string): string {
  let s = p.replace(/\\/g, "/");
  s = s.replace(DRIVE_PREFIX_RE, "");
  s = s.replace(/\/{2,}/g, "/");
  return s.toLowerCase();
}

export function isSensitivePath(p: string): boolean {
  if (typeof p !== "string" || p.length === 0) return false;
  const base = basename(p);
  for (const re of SENSITIVE_BASENAME_RE) {
    if (re.test(base)) return true;
  }
  const cmp = normalizeForCompare(p);
  const padded = `${cmp}/`;
  for (const seg of SENSITIVE_DIR_SEGMENTS) {
    if (padded.includes(`/${seg}/`)) return true;
  }
  for (const prefix of SENSITIVE_PATH_PREFIXES) {
    if (padded.startsWith(prefix)) return true;
  }
  return false;
}

function eachSegment(p: string): string[] {
  const sepRe = sep === "\\" ? /[/\\]/ : /\//;
  return p.split(sepRe).filter(Boolean);
}

/**
 * One-shot guard combining all path-safety checks. Throws
 * {@link PathGuardError} on refusal; returns the realpath-resolved canonical
 * path on success so callers can use it directly (no TOCTOU window).
 */
export async function assertSafePath(p: string, opts: { allowedBases: string[] }): Promise<string> {
  if (typeof p !== "string" || p.length === 0) {
    throw new PathGuardError("sensitive-path", p, "Refused: empty path.");
  }
  if (hasBidiChars(p)) {
    throw new PathGuardError(
      "bidi-chars",
      p,
      "Refused: path contains Unicode bidirectional override characters.",
    );
  }
  for (const segment of eachSegment(p)) {
    if (hasBidiChars(segment)) {
      throw new PathGuardError(
        "bidi-chars",
        p,
        "Refused: path segment contains Unicode bidirectional override characters.",
      );
    }
  }
  if (hasAdsSuffix(p)) {
    throw new PathGuardError(
      "ads-suffix",
      p,
      "Refused: path contains an NTFS Alternate Data Stream suffix.",
    );
  }
  if (isSensitivePath(p)) {
    throw new PathGuardError(
      "sensitive-path",
      p,
      "Refused: path targets a sensitive credential or system location.",
    );
  }
  const canonical = await realpathSafe(p);
  if (isSensitivePath(canonical)) {
    throw new PathGuardError(
      "sensitive-path",
      p,
      "Refused: canonical path resolves to a sensitive location.",
    );
  }
  const allowed = await isPathAllowed(p, opts.allowedBases);
  if (!allowed) {
    throw new PathGuardError(
      "outside-allowed-bases",
      p,
      "Refused: path is outside the allowed project bases.",
    );
  }
  return canonical;
}
