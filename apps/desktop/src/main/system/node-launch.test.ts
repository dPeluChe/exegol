import { describe, expect, it } from "vitest";
import { nodeLaunch, nodeShellCommand } from "./node-launch";

const MAC = "/Applications/Exegol.app/Contents/MacOS/Exegol";
const MAC_SHIM = "/Applications/Exegol.app/Contents/Resources/app.asar/out/main/shim.js";
const MOUNT = "/tmp/.mount_ExegoAb12";
const APPIMAGE = "/home/me/Apps/Exegol-0.5.25-x86_64.AppImage";
const SHIM = `${MOUNT}/resources/app.asar/out/main/exegol-mcp-shim-bin.js`;

describe("nodeLaunch", () => {
  it("runs the script with the app binary on macOS, a .deb/.rpm and in dev", () => {
    expect(nodeLaunch(MAC_SHIM, { platform: "darwin", execPath: MAC })).toEqual({
      command: MAC,
      args: [MAC_SHIM],
    });
    const opt = "/opt/Exegol/resources/app.asar/out/main/shim.js";
    expect(nodeLaunch(opt, { platform: "linux", execPath: "/opt/Exegol/exegol" })).toEqual({
      command: "/opt/Exegol/exegol",
      args: [opt],
    });
  });

  it("from an AppImage, runs the .AppImage and finds the script in its new mount", () => {
    const launch = nodeLaunch(SHIM, {
      platform: "linux",
      execPath: `${MOUNT}/exegol`,
      appImage: APPIMAGE,
    });
    expect(launch.command).toBe(APPIMAGE);
    expect(launch.args[0]).toBe("-e");
    expect(launch.args[1]).toContain('"resources/app.asar/out/main/exegol-mcp-shim-bin.js"');
    expect(launch.args.join(" ")).not.toContain(MOUNT);
  });

  it("keeps a script outside the mount as it is", () => {
    const ctx = { platform: "linux", execPath: `${MOUNT}/exegol`, appImage: APPIMAGE };
    expect(nodeLaunch("/home/me/x.js", ctx)).toEqual({
      command: `${MOUNT}/exegol`,
      args: ["/home/me/x.js"],
    });
  });
});

describe("nodeShellCommand", () => {
  it("keeps the double-quoted form for plain paths", () => {
    expect(nodeShellCommand({ command: MAC, args: [MAC_SHIM] })).toBe(
      `ELECTRON_RUN_AS_NODE=1 "${MAC}" "${MAC_SHIM}"`,
    );
  });

  it("single-quotes the AppImage code", () => {
    const cmd = nodeShellCommand({ command: APPIMAGE, args: ["-e", `a("x");b('y')`] });
    expect(cmd).toBe(`ELECTRON_RUN_AS_NODE=1 "${APPIMAGE}" "-e" 'a("x");b('\\''y'\\'')'`);
  });
});
