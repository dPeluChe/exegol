import { describe, expect, it } from "vitest";
import { inheritedTrust } from "./claude-trust";

describe("inheritedTrust", () => {
  const root = "/repo";
  const wt = "/home/u/.exegol/worktrees/repo-feat";

  it("a folder of a trusted project is trusted, keeping its other settings", () => {
    const next = inheritedTrust(
      { projects: { [root]: { hasTrustDialogAccepted: true }, [wt]: { allowedTools: [] } } },
      wt,
      root,
    );
    expect(next?.projects?.[wt]).toEqual({ allowedTools: [], hasTrustDialogAccepted: true });
  });

  it("never grants trust the user did not give the project, nor writes when nothing changes", () => {
    expect(inheritedTrust({ projects: {} }, wt, root)).toBeNull();
    expect(inheritedTrust({}, wt, root)).toBeNull();
    const trusted = {
      projects: {
        [root]: { hasTrustDialogAccepted: true },
        [wt]: { hasTrustDialogAccepted: true },
      },
    };
    expect(inheritedTrust(trusted, wt, root)).toBeNull();
  });
});
