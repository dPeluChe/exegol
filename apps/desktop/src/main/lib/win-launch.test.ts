import { describe, expect, it } from "vitest";
import { launchFor } from "./win-launch";

describe("launchFor", () => {
  it("spawns as is off Windows and for a Windows .exe", () => {
    expect(launchFor(["/usr/local/bin/code", "/a b"], "darwin")).toEqual({
      command: "/usr/local/bin/code",
      args: ["/a b"],
      verbatim: false,
    });
    expect(launchFor(["C:\\IDE\\idea64.exe", "C:\\p"], "win32").verbatim).toBe(false);
    // A .cmd off Windows is just a file name
    expect(launchFor(["x.cmd"], "linux").verbatim).toBe(false);
  });

  it("runs a .cmd through cmd.exe with quoted, caret-escaped arguments", () => {
    const l = launchFor(
      ["C:\\Program Files\\Microsoft VS Code\\bin\\code.cmd", "C:\\work\\a&b (1)", "-g"],
      "win32",
      "C:\\Windows\\system32\\cmd.exe",
    );
    expect(l.command).toBe("C:\\Windows\\system32\\cmd.exe");
    expect(l.verbatim).toBe(true);
    expect(l.args.slice(0, 3)).toEqual(["/d", "/s", "/c"]);
    expect(l.args[3]).toBe(
      '"C:\\Program^ Files\\Microsoft^ VS^ Code\\bin\\code.cmd ^"C:\\work\\a^&b^ ^(1^)^" ^"-g^""',
    );
  });

  it("keeps a trailing backslash from escaping the closing quote", () => {
    const l = launchFor(["code.bat", "C:\\dir\\"], "win32");
    expect(l.args[3]).toBe('"code.bat ^"C:\\dir\\\\^""');
  });
});
