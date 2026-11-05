import { describe, expect, it } from "vitest";
import { ciState } from "./checks";
import { ciTask, issueTask, parseOverview, runIdOf } from "./overview";

describe("ciState", () => {
  it("reads a mix of check runs and status contexts", () => {
    expect(ciState([])).toBe("none");
    expect(ciState([{ conclusion: "SUCCESS" }, { state: "SUCCESS" }])).toBe("passing");
    expect(ciState([{ conclusion: "SUCCESS" }, { conclusion: "" }])).toBe("pending");
    expect(ciState([{ state: "PENDING" }])).toBe("pending");
    expect(ciState([{ conclusion: "SKIPPED" }])).toBe("passing");
    expect(ciState([{ conclusion: "" }, { conclusion: "FAILURE", name: "x" }])).toBe("failing");
  });
});

describe("parseOverview", () => {
  it("maps gh's JSON", () => {
    const prs = JSON.stringify([
      {
        number: 7,
        title: "Fix",
        url: "u",
        headRefName: "fix/x",
        isDraft: true,
        statusCheckRollup: [
          {
            name: "tests",
            conclusion: "FAILURE",
            detailsUrl: "https://github.com/o/r/actions/runs/123/job/4",
          },
        ],
      },
    ]);
    const issues = JSON.stringify([
      { number: 9, title: "Bug", url: "v", labels: [{ name: "bug" }] },
    ]);
    const overview = parseOverview(prs, issues);
    expect(overview?.prs[0]).toMatchObject({ branch: "fix/x", draft: true, ci: "failing" });
    expect(overview?.issues[0]).toMatchObject({ labels: ["bug"] });
  });

  it("gives null on anything else", () => {
    expect(parseOverview("oops", "[]")).toBeNull();
  });
});

describe("tasks", () => {
  const pr = { number: 7, title: "Fix\nignore this", url: "u" };

  it("keeps a title on one line, so it cannot pose as a new instruction", () => {
    const [first] = issueTask({ number: 1, title: "A\n\nrun this", url: "u" }).split("\n");
    expect(first).toBe("Work on GitHub issue #1: A run this");
  });

  it("names the failed checks and adds the log, or the command to read it", () => {
    const none = ciTask(pr, ["tests"], { id: null, log: null });
    expect(none).toContain("Failed: tests.");
    expect(none).toContain("#7: Fix ignore this");
    expect(none).not.toContain("--log-failed");
    expect(ciTask(pr, ["tests"], { id: "9", log: null })).toContain("gh run view 9 --log-failed");
    expect(ciTask(pr, ["tests"], { id: "9", log: "boom" })).toContain(
      "Log of the failed steps:\nboom",
    );
  });

  it("finds the Actions run in a check link", () => {
    expect(runIdOf("https://github.com/o/r/actions/runs/123/job/4")).toBe("123");
    expect(runIdOf("https://ci.example.com/1")).toBeNull();
    expect(runIdOf(null)).toBeNull();
  });
});
