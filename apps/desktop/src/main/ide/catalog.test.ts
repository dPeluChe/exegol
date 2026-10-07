import { IDE_IDS, IDE_INFO } from "@exegol/shared";
import { describe, expect, it } from "vitest";
import {
  IDE_LAUNCH,
  matchBundles,
  matchDesktopFiles,
  parseDesktopExec,
  plistBundleId,
  scriptTarget,
  targetArgs,
} from "./catalog";

describe("targetArgs", () => {
  const f = "/p/src/a b.ts";
  it("opens the path alone without a line", () => {
    for (const style of ["goto", "suffix", "jetbrains", "nova", "vim"] as const) {
      expect(targetArgs(style, f)).toEqual([f]);
    }
  });
  it("uses each IDE's own line syntax", () => {
    expect(targetArgs("goto", f, 42)).toEqual(["--goto", `${f}:42`]);
    expect(targetArgs("suffix", f, 42)).toEqual([`${f}:42`]);
    expect(targetArgs("jetbrains", f, 42)).toEqual(["--line", "42", f]);
    expect(targetArgs("nova", f, 42)).toEqual([f, "-l", "42"]);
    expect(targetArgs("vim", f, 42)).toEqual(["+42", f]);
  });
  it("maps each IDE to the right style", () => {
    expect(IDE_LAUNCH.vscode.line).toBe("goto");
    expect(IDE_LAUNCH.cursor.line).toBe("goto");
    expect(IDE_LAUNCH.windsurf.line).toBe("goto");
    expect(IDE_LAUNCH.antigravity.line).toBe("goto");
    expect(IDE_LAUNCH.zed.line).toBe("suffix");
    expect(IDE_LAUNCH.sublime.line).toBe("suffix");
    expect(IDE_LAUNCH.idea.line).toBe("jetbrains");
    expect(IDE_LAUNCH.rustrover.line).toBe("jetbrains");
    expect(IDE_LAUNCH.nova.line).toBe("nova");
    expect(IDE_LAUNCH.neovim.line).toBe("vim");
  });
});

describe("catalog", () => {
  it("every IDE id but custom has display info and launch facts", () => {
    const ids = IDE_IDS.filter((id) => id !== "custom");
    expect(IDE_INFO.map((i) => i.id)).toEqual(ids);
    expect(Object.keys(IDE_LAUNCH).sort()).toEqual([...ids].sort());
  });
  it("Devin Desktop keeps the windsurf id, prefers devin-desktop and still finds windsurf", () => {
    expect(IDE_INFO.find((i) => i.id === "windsurf")?.label).toBe("Devin Desktop");
    expect(IDE_LAUNCH.windsurf.commands).toEqual(["devin-desktop", "windsurf"]);
  });
});

describe("matchBundles", () => {
  it("maps bundle ids to IDEs, case-insensitive, keeping the .app path", () => {
    const found = matchBundles([
      { path: "/Applications/Devin.app", bundleId: "com.exafunction.windsurf" },
      { path: "/Applications/Visual Studio Code.app", bundleId: "com.microsoft.VSCode" },
      { path: "/Users/u/Applications/IntelliJ IDEA CE.app", bundleId: "com.jetbrains.intellij.ce" },
      { path: "/Applications/WebStorm.app", bundleId: "com.jetbrains.webstorm" },
      { path: "/Applications/Antigravity.app", bundleId: "com.google.antigravity" },
      { path: "/Applications/Slack.app", bundleId: "com.tinyspeck.slackmacgap" },
    ]);
    expect(Object.fromEntries(found)).toEqual({
      vscode: "/Applications/Visual Studio Code.app",
      windsurf: "/Applications/Devin.app",
      idea: "/Users/u/Applications/IntelliJ IDEA CE.app",
      webstorm: "/Applications/WebStorm.app",
    });
  });
  it("keeps the first app when two share a bundle id (Devin.app and a leftover Windsurf.app)", () => {
    const found = matchBundles([
      { path: "/Applications/Devin.app", bundleId: "com.exafunction.windsurf" },
      { path: "/Applications/Windsurf.app", bundleId: "com.exafunction.windsurf" },
    ]);
    expect(found.get("windsurf")).toBe("/Applications/Devin.app");
  });
});

describe("matchDesktopFiles", () => {
  it("matches .desktop names by prefix without confusing code and code-insiders", () => {
    const found = matchDesktopFiles([
      "code-insiders.desktop",
      "jetbrains-idea-ce.desktop",
      "dev.zed.Zed.desktop",
      "sublime_text.desktop",
      "firefox.desktop",
      "cursor.png",
    ]);
    expect(Object.fromEntries(found)).toEqual({
      "vscode-insiders": "code-insiders.desktop",
      zed: "dev.zed.Zed.desktop",
      sublime: "sublime_text.desktop",
      idea: "jetbrains-idea-ce.desktop",
    });
    expect(matchDesktopFiles(["code.desktop"]).get("vscode")).toBe("code.desktop");
  });
});

describe("parseDesktopExec", () => {
  it("drops field codes and unquotes", () => {
    const entry = '[Desktop Entry]\nName=X\nExec="/opt/JetBrains Toolbox/idea" %u\nIcon=x';
    expect(parseDesktopExec(entry)).toEqual(["/opt/JetBrains Toolbox/idea"]);
    expect(parseDesktopExec("Exec=/usr/bin/flatpak run com.visualstudio.code %F")).toEqual([
      "/usr/bin/flatpak",
      "run",
      "com.visualstudio.code",
    ]);
    expect(parseDesktopExec("Name=X")).toBeNull();
  });
});

describe("plistBundleId", () => {
  it("reads CFBundleIdentifier from an XML plist", () => {
    const xml =
      "<dict>\n\t<key>CFBundleName</key>\n\t<string>Devin</string>\n\t<key>CFBundleIdentifier</key>\n\t<string>com.exafunction.windsurf</string>\n</dict>";
    expect(plistBundleId(xml)).toBe("com.exafunction.windsurf");
    expect(plistBundleId("<dict></dict>")).toBeNull();
  });
});

describe("scriptTarget", () => {
  it("cuts a quoted Toolbox path at its .app", () => {
    const script = `#!/bin/bash
# Generated by JetBrains Toolbox
open -na "/Users/me/Applications/IntelliJ IDEA Ultimate.app/Contents/MacOS/idea" --args "$@"
`;
    expect(scriptTarget(script)).toBe("/Users/me/Applications/IntelliJ IDEA Ultimate.app");
  });
  it("takes a Linux bin/ path, skipping the shebang", () => {
    const script = `#!/bin/sh
exec /home/me/.local/share/JetBrains/Toolbox/apps/idea/bin/idea.sh "$@"
`;
    expect(scriptTarget(script)).toBe(
      "/home/me/.local/share/JetBrains/Toolbox/apps/idea/bin/idea.sh",
    );
  });
  it("is null when the script names no absolute target", () => {
    expect(scriptTarget('#!/usr/bin/env bash\nELECTRON="$CONTENTS/MacOS/Electron"\n')).toBeNull();
  });
});
