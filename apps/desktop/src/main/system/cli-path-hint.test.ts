import { describe, expect, it } from "vitest";
import { cliPathHint } from "./cli-path-hint";

const HOME = "/home/ana";
const TARGET = "/home/ana/.local/bin/exegol";

describe("cliPathHint", () => {
  it("is null when the folder is on PATH", () => {
    expect(cliPathHint(TARGET, "/usr/bin:/home/ana/.local/bin/", HOME, "/bin/bash")).toBeNull();
    expect(cliPathHint(TARGET, "/usr/bin:~/.local/bin", HOME)).toBeNull();
    expect(cliPathHint("/usr/local/bin/exegol", "/usr/local/bin:/usr/bin", HOME)).toBeNull();
  });

  it("gives the bash or zsh line with $HOME", () => {
    expect(cliPathHint(TARGET, "/usr/bin:/bin", HOME, "/bin/bash")).toEqual({
      line: 'export PATH="$HOME/.local/bin:$PATH"',
      file: "~/.bashrc",
    });
    expect(cliPathHint(TARGET, "/usr/bin", HOME, "/usr/bin/zsh")?.file).toBe("~/.zshrc");
    expect(cliPathHint(TARGET, "", HOME)?.file).toBe("~/.bashrc");
  });

  it("gives fish its own command", () => {
    expect(cliPathHint(TARGET, "/usr/bin", HOME, "/usr/bin/fish")).toEqual({
      line: "fish_add_path $HOME/.local/bin",
      file: "~/.config/fish/config.fish",
    });
  });

  it("keeps a folder outside home as is", () => {
    expect(cliPathHint("/usr/local/bin/exegol", "/usr/bin", HOME, "/bin/bash")?.line).toBe(
      'export PATH="/usr/local/bin:$PATH"',
    );
  });
});
