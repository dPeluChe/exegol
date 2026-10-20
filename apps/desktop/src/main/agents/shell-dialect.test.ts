import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import {
  oneShotArgs,
  pwshInteractiveArgs,
  quoteArg,
  quotePath,
  runAndExit,
  shellKind,
  submitKey,
  windowsShell,
} from "./shell-dialect";

describe("shellKind", () => {
  it("keeps macOS and Linux on posix or fish, even for a pwsh $SHELL", () => {
    expect(shellKind("/bin/zsh", "darwin")).toBe("posix");
    expect(shellKind("/usr/bin/bash", "linux")).toBe("posix");
    expect(shellKind("/opt/homebrew/bin/fish", "darwin")).toBe("fish");
    expect(shellKind("/usr/local/bin/pwsh", "darwin")).toBe("posix");
  });

  it("reads Windows paths, any case, with or without .exe", () => {
    expect(shellKind("C:\\Program Files\\PowerShell\\7\\pwsh.exe", "win32")).toBe("pwsh");
    expect(
      shellKind("C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe", "win32"),
    ).toBe("pwsh");
    expect(shellKind("C:\\WINDOWS\\system32\\CMD.EXE", "win32")).toBe("cmd");
    expect(shellKind("cmd.exe", "win32")).toBe("cmd");
  });
});

describe("windowsShell", () => {
  const found =
    (...names: string[]) =>
    (c: string) =>
      names.includes(c) ? `C:\\bin\\${c}` : null;

  it("prefers PowerShell 7, then Windows PowerShell, then ComSpec", () => {
    expect(windowsShell({}, found("pwsh.exe", "powershell.exe"))).toBe("C:\\bin\\pwsh.exe");
    expect(windowsShell({}, found("powershell.exe"))).toBe("C:\\bin\\powershell.exe");
    expect(windowsShell({ ComSpec: "C:\\Windows\\system32\\cmd.exe" }, found())).toBe(
      "C:\\Windows\\system32\\cmd.exe",
    );
    expect(windowsShell({}, found())).toBe("cmd.exe");
  });
});

describe("quoteArg", () => {
  const prompt = `it's "done" for $HOME and \`x\`\nnext line`;

  // The POSIX form is the one Exegol always wrote: a real sh must read it back unchanged
  it("posix: single quotes", () => {
    expect(quoteArg("posix", "it's")).toBe("'it'\\''s'");
  });

  // Windows runners have no /bin/sh
  it.skipIf(process.platform === "win32")("posix: a real sh reads it back exactly", () => {
    const echoed = execFileSync("/bin/sh", ["-c", `printf '%s' ${quoteArg("posix", prompt)}`]);
    expect(echoed.toString()).toBe(prompt);
  });

  it("pwsh: one line, every special character escaped with a backtick", () => {
    const q = quoteArg("pwsh", prompt);
    expect(q).not.toContain("\n");
    expect(q).toBe('"it\'s `"done`" for `$HOME and ``x```nnext line"');
    expect(quoteArg("pwsh", "smart \u201Cquotes\u201D")).toBe('"smart `\u201Cquotes`\u201D"');
  });

  it("cmd: doubled quotes, newlines as spaces", () => {
    expect(quoteArg("cmd", 'say "hi"\r\nbye')).toBe('"say ""hi"" bye"');
  });
});

describe("quotePath", () => {
  it("leaves plain paths bare and quotes the rest", () => {
    expect(quotePath("posix", "/Users/me/.exegol/hooks/a.json")).toBe(
      "/Users/me/.exegol/hooks/a.json",
    );
    expect(quotePath("posix", "/Users/my name/a.json")).toBe("'/Users/my name/a.json'");
    expect(quotePath("pwsh", "C:\\Users\\me\\.exegol\\a.json")).toBe(
      "C:\\Users\\me\\.exegol\\a.json",
    );
    expect(quotePath("pwsh", "C:\\Users\\Jo Ann\\a.json")).toBe('"C:\\Users\\Jo Ann\\a.json"');
    // A backslash is an escape in sh: never bare there
    expect(quotePath("posix", "a\\b")).toBe("'a\\b'");
  });
});

describe("shell lifecycle per kind", () => {
  it("ends the shell with the CLI", () => {
    expect(runAndExit("posix", "claude")).toBe("exec claude");
    expect(runAndExit("fish", "claude")).toBe("exec claude");
    expect(runAndExit("pwsh", "claude")).toBe("claude; exit $LASTEXITCODE");
    expect(runAndExit("cmd", "claude")).toBe("claude & exit");
  });

  it("submits with LF on POSIX, CR under ConPTY", () => {
    expect(submitKey("posix")).toBe("\n");
    expect(submitKey("fish")).toBe("\n");
    expect(submitKey("pwsh")).toBe("\r");
    expect(submitKey("cmd")).toBe("\r");
  });

  it("starts PowerShell with the integration dot-sourced, cmd only by typing", () => {
    expect(pwshInteractiveArgs("C:\\Users\\me\\.exegol\\shell-integration\\profile.ps1")).toEqual([
      "-NoLogo",
      "-ExecutionPolicy",
      "Bypass",
      "-NoExit",
      "-Command",
      '. "C:\\Users\\me\\.exegol\\shell-integration\\profile.ps1"',
    ]);
    expect(oneShotArgs("pwsh", "claude")).toEqual([
      "-NoLogo",
      "-ExecutionPolicy",
      "Bypass",
      "-Command",
      "claude",
    ]);
    expect(oneShotArgs("cmd", "claude")).toBeNull();
    expect(oneShotArgs("posix", "claude")).toEqual(["-ic", "claude"]);
  });
});
