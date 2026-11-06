import { mkdirSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

const root = realpathSync.native(mkdtempSync(join(tmpdir(), "exegol-links-")));
const project = join(root, "project");
const outside = join(root, "outside");
const otherProject = join(root, "other");
mkdirSync(join(project, "src"), { recursive: true });
mkdirSync(outside);
mkdirSync(otherProject);
const otherNotes = join(otherProject, "notes.md");
writeFileSync(otherNotes, "#");
mkdirSync(join(outside, ".ssh"));
writeFileSync(join(outside, ".ssh", "config"), "x");
writeFileSync(join(project, "src", "app.ts"), "export {};");
writeFileSync(join(outside, "secret.txt"), "nope");
symlinkSync(join(outside, "secret.txt"), join(project, "escape.txt"));

vi.mock("electron", () => ({ shell: { showItemInFolder: vi.fn(), openPath: vi.fn() } }));
vi.mock("../../ide/opener", () => ({ openInIde: vi.fn(), resolveIde: () => ({ ide: "vscode" }) }));
vi.mock("../../db/queries", () => ({
  getAgent: () => ({ projectId: "p1" }),
  getProject: () => ({ id: "p1", path: project }),
  getAgentCwd: () => project,
  listWorktrees: () => [],
}));

const { linkOpenAction, terminalLinksRouter } = await import("./terminal-links");
const caller = terminalLinksRouter.createCaller({ db: {} } as never);

async function resolved(texts: string[], cwd?: string) {
  const out = await caller.resolve({ agentId: "a1", texts, cwd });
  return out.map((r) => r.path);
}

describe("terminalLinks access", () => {
  it("links project files at their realpath", async () => {
    expect(await resolved(["src/app.ts"])).toEqual([join(project, "src", "app.ts")]);
  });

  it("offers only Finder for what exists outside the session's project", async () => {
    const texts = [join(outside, "secret.txt"), "escape.txt"];
    const rows = await caller.resolve({ agentId: "a1", texts });
    expect(rows.map((r) => r.revealOnly)).toEqual([true, true]);
    expect(rows[0]?.path).toBe(join(outside, "secret.txt"));
  });

  it("offers only Finder for a folder, in or out of the project", async () => {
    const rows = await caller.resolve({ agentId: "a1", texts: ["src/", `${outside}/`] });
    expect(rows.map((r) => r.revealOnly)).toEqual([true, true]);
  });

  it("never links sensitive paths, a missing path or a place out of reach", async () => {
    expect(
      await resolved([
        join(outside, ".ssh", "config"),
        "~/.exegol/hooks/a1.json",
        "/etc/hosts",
        "/Volumes/nas/a.mp4",
      ]),
    ).toEqual([null, null, null, null]);
  });

  it("reveals outside the project but refuses to open or read it there", async () => {
    const { shell } = await import("electron");
    await caller.open({ agentId: "a1", text: otherNotes, how: "reveal" });
    expect(shell.showItemInFolder).toHaveBeenCalledWith(otherNotes);
    for (const how of ["external", "ide"] as const) {
      await expect(caller.open({ agentId: "a1", text: otherNotes, how })).rejects.toThrow(
        /Not a project file/,
      );
    }
    await expect(caller.read({ agentId: "a1", text: otherNotes })).rejects.toThrow(
      /Not a project file/,
    );
    await expect(caller.open({ agentId: "a1", text: "/etc/hosts", how: "reveal" })).rejects.toThrow(
      /Not a project file/,
    );
  });

  it("reads a project file through the pinned fd", async () => {
    const out = await caller.read({ agentId: "a1", text: "src/app.ts" });
    expect(out).toMatchObject({ kind: "text", content: "export {};" });
  });

  it("refuses to read traversal, symlinks out and ~/.exegol", async () => {
    for (const text of ["../outside/secret.txt", "escape.txt", "~/.exegol/settings.json"]) {
      await expect(caller.read({ agentId: "a1", text })).rejects.toThrow(/Not a project file/);
    }
  });

  it("lets a renderer cwd narrow the session folder but never widen it", async () => {
    expect(await resolved(["app.ts"], join(project, "src"))).toEqual([
      join(project, "src", "app.ts"),
    ]);
    expect(await resolved(["secret.txt"], outside)).toEqual([null]);
  });

  it("never touches a network mount a shell reported as its folder", async () => {
    for (const cwd of [
      "/mnt/nas/x",
      "/media/me/usb",
      "/run/user/1000/gvfs/smb",
      "//server/share",
    ]) {
      expect(await resolved(["src/app.ts"], cwd)).toEqual([join(project, "src", "app.ts")]);
    }
  });
});

describe("linkOpenAction", () => {
  it("opens allowlisted documents with the default app", () => {
    expect(linkOpenAction("/p/spec.pdf", "external")).toBe("external");
    expect(linkOpenAction("/p/shot.PNG", "external")).toBe("external");
  });

  it("reveals anything that could run or redirect, whatever the renderer asked", () => {
    for (const ext of ["webloc", "url", "mobileconfig", "html", "svg", "sh", "command", "zip"]) {
      expect(linkOpenAction(`/p/x.${ext}`, "external")).toBe("reveal");
    }
    expect(linkOpenAction("/p/noext", "external")).toBe("reveal");
  });

  it("keeps reveal and IDE requests", () => {
    expect(linkOpenAction("/p/install.sh", "ide")).toBe("ide");
    expect(linkOpenAction("/p/spec.pdf", "reveal")).toBe("reveal");
  });
});
