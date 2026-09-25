import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { detectProjectIcons, isIconFile } from "./project-icons";

describe("detectProjectIcons", () => {
  it("finds app icons in the root and in subrepos, skipping oversized files", async () => {
    const root = mkdtempSync(join(tmpdir(), "exegol-icons-"));
    // A workspace of repos: the icon lives inside the app's own folder
    mkdirSync(join(root, "web", ".git"), { recursive: true });
    mkdirSync(join(root, "web", "public"), { recursive: true });
    writeFileSync(join(root, "web", "public", "favicon.ico"), Buffer.from([0, 0, 1, 0]));
    writeFileSync(join(root, "logo.svg"), "<svg xmlns='http://www.w3.org/2000/svg'/>");
    writeFileSync(join(root, "icon.png"), Buffer.alloc(600 * 1024)); // too big for an icon

    const icons = await detectProjectIcons(root);
    expect(icons.map((i) => i.rel).sort()).toEqual(["logo.svg", "web/public/favicon.ico"]);
    expect(icons.find((i) => i.rel === "logo.svg")?.dataUrl).toMatch(
      /^data:image\/svg\+xml;base64,/,
    );
  });

  it("accepts only image files as icons", () => {
    expect(isIconFile("/p/app/icon.png")).toBe(true);
    expect(isIconFile("/p/.env")).toBe(false);
  });
});
