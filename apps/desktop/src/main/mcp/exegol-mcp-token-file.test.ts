import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  readTokenFile,
  removeTokenFile,
  resolveShimToken,
  tokenFilePathFor,
  tokenFromEnvBlock,
  tokenKeyFor,
  writeTokenFile,
} from "./exegol-mcp-token-file";

let root = "";
let tokens = "";
let repo = "";

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "exegol-token-file-")));
  tokens = join(root, "tokens");
  repo = join(root, "repo");
  mkdirSync(repo);
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("tokenKeyFor", () => {
  it("is a 32-hex key, the same through a symlink and a trailing slash", () => {
    const key = tokenKeyFor(repo);
    expect(key).toMatch(/^[0-9a-f]{32}$/);
    symlinkSync(repo, join(root, "link"));
    expect(tokenKeyFor(join(root, "link"))).toBe(key);
    expect(tokenKeyFor(`${repo}/`)).toBe(key);
    expect(tokenKeyFor(join(root, "other"))).not.toBe(key);
  });
});

describe("writeTokenFile / readTokenFile", () => {
  it("writes 0600 in a 0700 dir, reads it back trimmed, removes it", () => {
    const path = writeTokenFile(repo, "abc123", tokens);
    expect(path).toBe(tokenFilePathFor(repo, tokens));
    // Windows has no POSIX modes: the user profile's ACL guards ~/.exegol there
    if (process.platform !== "win32") {
      expect(statSync(tokens).mode & 0o777).toBe(0o700);
      expect(statSync(path).mode & 0o777).toBe(0o600);
    }
    writeFileSync(path, "abc123\n");
    expect(readTokenFile(path, tokens)).toBe("abc123");
    expect(writeTokenFile(repo, "newer", tokens)).toBe(path);
    expect(readFileSync(path, "utf-8")).toBe("newer");
    removeTokenFile(repo, tokens);
    expect(readTokenFile(path, tokens)).toBeNull();
  });

  it("replaces a symlink at the target instead of writing through it", () => {
    mkdirSync(tokens, { recursive: true });
    const victim = join(root, "victim");
    writeFileSync(victim, "keep");
    symlinkSync(victim, tokenFilePathFor(repo, tokens));
    writeTokenFile(repo, "t", tokens);
    expect(readFileSync(victim, "utf-8")).toBe("keep");
  });

  it("refuses a path outside the tokens dir, a relative path, a symlink and a directory", () => {
    const outside = join(root, "outside");
    writeFileSync(outside, "stolen");
    expect(readTokenFile(outside, tokens)).toBeNull();
    mkdirSync(join(tokens, "sub"), { recursive: true });
    writeFileSync(join(tokens, "sub", "x"), "nested");
    expect(readTokenFile(join(tokens, "sub", "x"), tokens)).toBeNull();
    expect(readTokenFile(join(tokens, "..", "outside"), tokens)).toBeNull();
    expect(readTokenFile("tokens/x", tokens)).toBeNull();
    symlinkSync(outside, join(tokens, "link"));
    expect(readTokenFile(join(tokens, "link"), tokens)).toBeNull();
    expect(readTokenFile(join(tokens, "sub"), tokens)).toBeNull();
  });
});

describe("tokenFromEnvBlock", () => {
  it("follows the path first, then the legacy inline keys", () => {
    const path = writeTokenFile(repo, "from-file", tokens);
    expect(
      tokenFromEnvBlock({ EXEGOL_MCP_TOKEN_PATH: path, EXEGOL_MCP_TOKEN_FILE: "inline" }, tokens),
    ).toBe("from-file");
    expect(tokenFromEnvBlock({ EXEGOL_MCP_TOKEN_FILE: "inline" }, tokens)).toBe("inline");
    expect(tokenFromEnvBlock({ EXEGOL_MCP_TOKEN: "older" }, tokens)).toBe("older");
    expect(tokenFromEnvBlock({ EXEGOL_MCP_TOKEN_PATH: join(root, "nope") }, tokens)).toBeNull();
    expect(tokenFromEnvBlock(undefined, tokens)).toBeNull();
  });
});

describe("resolveShimToken", () => {
  it("per-session env, then the env path, then legacy inline, then the cwd .mcp.json", () => {
    const path = writeTokenFile(repo, "dir-token", tokens);
    const all = {
      EXEGOL_MCP_TOKEN: "session",
      EXEGOL_MCP_TOKEN_PATH: path,
      EXEGOL_MCP_TOKEN_FILE: "legacy",
    };
    expect(resolveShimToken(all, repo, tokens)).toBe("session");
    expect(resolveShimToken({ ...all, EXEGOL_MCP_TOKEN: undefined }, repo, tokens)).toBe(
      "dir-token",
    );
    expect(resolveShimToken({ EXEGOL_MCP_TOKEN_FILE: "legacy" }, repo, tokens)).toBe("legacy");
    expect(resolveShimToken({}, repo, tokens)).toBe("");

    // codex: env sanitized, the cwd .mcp.json names the path
    const mcpJson = (env: Record<string, string>) =>
      writeFileSync(join(repo, ".mcp.json"), JSON.stringify({ mcpServers: { exegol: { env } } }));
    mcpJson({ EXEGOL_MCP_TOKEN_PATH: path });
    expect(resolveShimToken({}, repo, tokens)).toBe("dir-token");
    mcpJson({ EXEGOL_MCP_TOKEN_FILE: "old-build" });
    expect(resolveShimToken({}, repo, tokens)).toBe("old-build");
  });

  it("does not read a token file a repo config points outside the tokens dir", () => {
    const outside = join(root, "secret");
    writeFileSync(outside, "not-a-token");
    expect(resolveShimToken({ EXEGOL_MCP_TOKEN_PATH: outside }, repo, tokens)).toBe("");
    writeFileSync(
      join(repo, ".mcp.json"),
      JSON.stringify({ mcpServers: { exegol: { env: { EXEGOL_MCP_TOKEN_PATH: outside } } } }),
    );
    expect(resolveShimToken({}, repo, tokens)).toBe("");
  });
});
