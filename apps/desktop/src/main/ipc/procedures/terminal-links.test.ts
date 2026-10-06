import { mkdirSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

const root = realpathSync(mkdtempSync(join(tmpdir(), "exegol-links-")));
const project = join(root, "project");
const outside = join(root, "outside");
mkdirSync(join(project, "src"), { recursive: true });
mkdirSync(outside);
writeFileSync(join(project, "src", "app.ts"), "export {};");
writeFileSync(join(outside, "secret.txt"), "nope");
symlinkSync(join(outside, "secret.txt"), join(project, "escape.txt"));

vi.mock("electron", () => ({ shell: { showItemInFolder: vi.fn(), openPath: vi.fn() } }));
vi.mock("../../ide/opener", () => ({ openInIde: vi.fn() }));
vi.mock("../../db/queries/settings", () => ({ getAppSettings: () => ({ defaultIde: "vscode" }) }));
vi.mock("../../db/queries", () => ({
  getAgent: () => null,
  getProject: () => null,
  getAgentCwd: () => project,
  listProjects: () => [{ path: project }],
  listAllWorktreeRows: () => [],
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

  it("does not linkify paths outside the projects, even ones that exist", async () => {
    expect(
      await resolved([
        "../outside/secret.txt",
        join(outside, "secret.txt"),
        "escape.txt",
        "~/.exegol/hooks/a1.json",
      ]),
    ).toEqual([null, null, null, null]);
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
