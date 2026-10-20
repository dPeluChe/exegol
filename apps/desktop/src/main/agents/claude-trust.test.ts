import path from "node:path";
import { describe, expect, it } from "vitest";
import { inheritedTrust, trustKey } from "./claude-trust";

describe("inheritedTrust", () => {
  const root = "/repo";
  const wt = "/home/u/.exegol/worktrees/repo-feat";

  it("a folder of a trusted project is trusted, keeping its other settings", () => {
    const next = inheritedTrust(
      { projects: { [root]: { hasTrustDialogAccepted: true }, [wt]: { allowedTools: [] } } },
      wt,
      root,
      path.posix,
    );
    expect(next?.projects?.[wt]).toEqual({ allowedTools: [], hasTrustDialogAccepted: true });
  });

  it("never grants trust the user did not give the project, nor writes when nothing changes", () => {
    expect(inheritedTrust({ projects: {} }, wt, root, path.posix)).toBeNull();
    expect(inheritedTrust({}, wt, root, path.posix)).toBeNull();
    const trusted = {
      projects: {
        [root]: { hasTrustDialogAccepted: true },
        [wt]: { hasTrustDialogAccepted: true },
      },
    };
    expect(inheritedTrust(trusted, wt, root, path.posix)).toBeNull();
  });

  it("on Windows keys the folder as Claude does, forward slashes", () => {
    expect(trustKey("C:\\Users\\me\\repo\\", path.win32)).toBe("C:/Users/me/repo/");
    const next = inheritedTrust(
      { projects: { "C:/repo": { hasTrustDialogAccepted: true } } },
      "C:\\Users\\u\\.exegol\\worktrees\\repo-feat",
      "C:\\repo",
      path.win32,
    );
    expect(next?.projects?.["C:/Users/u/.exegol/worktrees/repo-feat"]).toEqual({
      hasTrustDialogAccepted: true,
    });
  });
});
