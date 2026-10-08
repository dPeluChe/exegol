import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Configuration } from "electron-builder";

// One folder per version (dist/0.5.1/...) so builds don't pile up side by side
const version = readVersion();

function readVersion(): string {
  const pkg: unknown = JSON.parse(readFileSync(resolve("package.json"), "utf8"));
  const found = pkg && typeof pkg === "object" && "version" in pkg ? pkg.version : undefined;
  // A build must never land in dist/undefined
  if (typeof found !== "string") throw new Error("apps/desktop/package.json has no version");
  return found;
}

const iconPath = resolve("src/resources/build/icons");

// biome-ignore lint/suspicious/noTemplateCurlyInString: electron-builder template vars (not JS)
const DMG_NAME = "Exegol-${version}-${arch}.dmg";
// biome-ignore lint/suspicious/noTemplateCurlyInString: electron-builder template vars
const EXE_NAME = "Exegol-${version}-${arch}.exe";
// biome-ignore lint/suspicious/noTemplateCurlyInString: electron-builder template vars
const APPIMAGE_NAME = "Exegol-${version}-${arch}.AppImage";
// biome-ignore lint/suspicious/noTemplateCurlyInString: electron-builder template vars
const DEB_NAME = "exegol_${version}_${arch}.deb";

const config: Configuration = {
  appId: "com.exegol.desktop",
  productName: "Exegol",
  copyright: "Copyright 2026 Exegol",

  directories: {
    output: `dist/${version}`,
    buildResources: "src/resources/build",
  },

  files: ["out/**/*", "!out/**/*.map", "package.json"],

  asar: true,
  asarUnpack: [
    "out/main/pty-sidecar-entry.js",
    "node_modules/node-pty/**",
    "node_modules/libsql/**",
    "node_modules/@libsql/**",
    "node_modules/@neon-rs/**",
    "node_modules/bindings/**",
    "node_modules/file-uri-to-path/**",
    "node_modules/better-sqlite3/**",
    // Dictation engine (T201): the N-API addon and the onnxruntime/sherpa dylibs (.so) beside it,
    // loaded by path from the utilityProcess, so they must be real files (and get signed)
    "node_modules/sherpa-onnx-node/**",
    "node_modules/sherpa-onnx-*/**",
    // @exegol/core-rust is shipped via extraResources (see below), not
    // asarUnpack, because it's a workspace symlink outside apps/desktop
    // scope that electron-builder doesn't resolve through the usual
    // node_modules collection.
  ],

  // Bundle the @exegol/core-rust package as an extra resource. It's a
  // workspace package symlinked at the repo root's node_modules, so
  // electron-builder's default file collector doesn't include it. We
  // ship index.js/d.ts + package.json (so it can be required normally)
  // and all .node binaries for the current platform. The runtime
  // fallback in spawn-env.ts loads it from process.resourcesPath.
  extraResources: [
    {
      from: "../../packages/core-rust",
      to: "core-rust",
      filter: ["*.node", "index.js", "index.d.ts", "package.json"],
    },
    { from: "src/resources/build/icons/icon.png", to: "tray-icon.png" },
    // T155.6: `exegol` CLI opener script, symlinked onto PATH via the app menu
    {
      from: "resources/bin",
      to: "bin",
    },
  ],

  // T155.6: exegol:// deep link (packaged registration; dev uses
  // app.setAsDefaultProtocolClient with execPath args)
  protocols: [{ name: "Exegol", schemes: ["exegol"] }],

  generateUpdatesFilesForAllChannels: true,

  // ─── macOS ──────────────────────────────────────────────────────────
  mac: {
    icon: resolve(iconPath, "icon.icns"),
    category: "public.app-category.developer-tools",
    target: "default",
    hardenedRuntime: true,
    gatekeeperAssess: false,
    // Notarized when a notarytool keychain profile is given (APPLE_KEYCHAIN_PROFILE=<profile>,
    // see docs/GUIDES/RELEASE.md). Without it macOS refuses the downloaded DMG ("could not verify")
    notarize: !!process.env.APPLE_KEYCHAIN_PROFILE,
    entitlements: "src/resources/build/entitlements.mac.plist",
    entitlementsInherit: "src/resources/build/entitlements.mac.inherit.plist",
    darkModeSupport: true,
    extendInfo: {
      NSAppleEventsUsageDescription:
        "Exegol needs automation access to open IDEs, manage terminals and, if you turn it on, pause your music while you dictate.",
      NSMicrophoneUsageDescription:
        "Exegol uses the microphone only while you dictate. Speech is transcribed on this Mac and never leaves it.",
    },
  },

  dmg: {
    artifactName: DMG_NAME,
    background: "src/resources/build/dmg-background.png",
    window: { width: 540, height: 380 },
    contents: [
      { x: 145, y: 185 },
      { x: 395, y: 185, type: "link", path: "/Applications" },
    ],
  },

  // ─── Windows ────────────────────────────────────────────────────────
  win: {
    icon: resolve(iconPath, "icon.ico"),
    target: [{ target: "nsis", arch: ["x64"] }],
    artifactName: EXE_NAME,
  },

  nsis: {
    oneClick: false,
    allowToChangeInstallationDirectory: true,
    perMachine: false,
    deleteAppDataOnUninstall: false,
  },

  // ─── Linux ──────────────────────────────────────────────────────────
  // Built on Linux by .github/workflows/linux.yml (native modules cannot be cross-built from a Mac).
  // AppImage runs on most distros and self-updates; the .deb installs natively on Debian/Ubuntu
  linux: {
    // Without it the binary, the .desktop file and the icon took the scoped package name
    // ("@exegoldesktop"); `exegol` itself is the CLI opener on PATH
    executableName: "exegol-desktop",
    // Every hicolor size: a 1024px icon alone showed no icon in KDE menus
    icon: resolve(iconPath, "linux"),
    target: [
      { target: "AppImage", arch: ["x64"] },
      { target: "deb", arch: ["x64"] },
    ],
    category: "Development",
    artifactName: APPIMAGE_NAME,
    maintainer: "Antonio <antonio@iteris.tech>",
    synopsis: "Orchestrate AI coding agents",
    description:
      "Run Claude Code, Codex, Gemini or any CLI coding agent side by side, each in its own terminal, with live status and one place to see which agent needs you.",
    // exegol:// deep links come from `protocols` above (listing them here too repeated the MIME type)
  },
  deb: {
    artifactName: DEB_NAME,
    packageCategory: "devel",
    // AppStream metadata: software centers (KDE Discover, GNOME Software) showed empty fields
    fpm: [
      `${resolve("src/resources/linux/com.exegol.desktop.metainfo.xml")}=/usr/share/metainfo/com.exegol.desktop.metainfo.xml`,
    ],
    // safeStorage keeps API keys in the desktop keyring (libsecret); without it they fall back
    depends: ["libsecret-1-0", "libnotify4", "libxss1", "libnss3"],
  },

  // ─── Auto-update publish config (GitHub Releases) ──────────────────
  publish: {
    provider: "github",
    owner: "dPeluChe",
    repo: "exegol",
    releaseType: "release",
  },
};

export default config;
