import { describe, expect, it } from "vitest";
import type { LifecycleConfig } from "./loader";
import { parseLifecycleYaml } from "./loader";

describe("parseLifecycleYaml", () => {
  it("parses all four keys", () => {
    const yaml = `
setup: npm install && bun run build:rust
beforeAgent: source .env.local
afterCommit: bun test
teardown: rm -rf dist
`;
    const config = parseLifecycleYaml(yaml);
    expect(config).toEqual({
      setup: "npm install && bun run build:rust",
      beforeAgent: "source .env.local",
      afterCommit: "bun test",
      teardown: "rm -rf dist",
    } satisfies LifecycleConfig);
  });

  it("returns null for empty content", () => {
    expect(parseLifecycleYaml("")).toBeNull();
  });

  it("returns null for comments-only content", () => {
    expect(parseLifecycleYaml("# just a comment\n# another")).toBeNull();
  });

  it("ignores unknown keys", () => {
    const yaml = `
setup: echo hi
unknown_key: should be ignored
`;
    const config = parseLifecycleYaml(yaml);
    expect(config).toEqual({ setup: "echo hi" });
  });

  it("supports snake_case aliases", () => {
    const yaml = `
before_agent: source .env
after_commit: npm test
`;
    const config = parseLifecycleYaml(yaml);
    expect(config).toEqual({
      beforeAgent: "source .env",
      afterCommit: "npm test",
    });
  });

  it("is case-insensitive for keys", () => {
    const yaml = `
Setup: echo setup
BeforeAgent: echo before
TEARDOWN: echo teardown
`;
    const config = parseLifecycleYaml(yaml);
    expect(config).toEqual({
      setup: "echo setup",
      beforeAgent: "echo before",
      teardown: "echo teardown",
    });
  });

  it("strips double-quoted values", () => {
    const yaml = `setup: "npm install"`;
    const config = parseLifecycleYaml(yaml);
    expect(config?.setup).toBe("npm install");
  });

  it("strips single-quoted values", () => {
    const yaml = `setup: 'npm install'`;
    const config = parseLifecycleYaml(yaml);
    expect(config?.setup).toBe("npm install");
  });

  it("strips trailing comments on unquoted values", () => {
    const yaml = `setup: npm install # install deps`;
    const config = parseLifecycleYaml(yaml);
    expect(config?.setup).toBe("npm install");
  });

  it("preserves # inside quoted values", () => {
    const yaml = `setup: "echo '# not a comment'"`;
    const config = parseLifecycleYaml(yaml);
    expect(config?.setup).toBe("echo '# not a comment'");
  });

  it("skips blank lines and comment lines", () => {
    const yaml = `
# Project lifecycle
setup: npm install

# Agent hooks
beforeAgent: source .env

`;
    const config = parseLifecycleYaml(yaml);
    expect(config).toEqual({
      setup: "npm install",
      beforeAgent: "source .env",
    });
  });

  it("handles values with colons", () => {
    const yaml = `setup: echo "key: value"`;
    const config = parseLifecycleYaml(yaml);
    expect(config?.setup).toBe('echo "key: value"');
  });

  it("returns null when all values are empty", () => {
    const yaml = `setup: `;
    expect(parseLifecycleYaml(yaml)).toBeNull();
  });
});
