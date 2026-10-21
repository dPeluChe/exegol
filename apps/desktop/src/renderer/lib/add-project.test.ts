import { describe, expect, it } from "vitest";
import { folderName, folderNotice, ipcErrorMessage } from "./add-project";

const base = { exists: true, isDirectory: true } as const;

describe("folderNotice", () => {
  it("puts an existing project first, even over a missing repo", () => {
    expect(
      folderNotice({ ...base, git: "none", existingProject: { id: "p1", name: "Argos" } }),
    ).toEqual({ kind: "existing", id: "p1", name: "Argos" });
  });

  it("names missing, non-folder, no repo and a folder inside a repo", () => {
    expect(folderNotice({ exists: false, isDirectory: false, git: "none" })).toEqual({
      kind: "missing",
    });
    expect(folderNotice({ exists: true, isDirectory: false, git: "none" })?.kind).toBe(
      "notDirectory",
    );
    expect(folderNotice({ ...base, git: "none" })?.kind).toBe("noGit");
    expect(folderNotice({ ...base, git: "subfolder", toplevel: "/r" })).toEqual({
      kind: "subfolder",
      toplevel: "/r",
    });
  });

  it("says nothing for a repo root or before the check", () => {
    expect(folderNotice({ ...base, git: "repo" })).toBeNull();
    expect(folderNotice(undefined)).toBeNull();
  });
});

describe("ipcErrorMessage", () => {
  it("drops Electron's wrapper", () => {
    const err = new Error(
      "Error invoking remote method 'trpc': Error: Already in Exegol as 'Argos'",
    );
    expect(ipcErrorMessage(err)).toBe("Already in Exegol as 'Argos'");
    expect(ipcErrorMessage(new Error("plain"))).toBe("plain");
  });
});

describe("folderName", () => {
  it("takes the last segment on both separators", () => {
    expect(folderName("/a/b/app/")).toBe("app");
    expect(folderName("C:\\code\\app")).toBe("app");
  });
});
