import { resolve } from "node:path";
import type { Configuration } from "electron-builder";

const iconPath = resolve("src/resources/build/icons");

// biome-ignore lint/suspicious/noTemplateCurlyInString: electron-builder template vars (not JS)
const DMG_NAME = "Exegol-${version}-${arch}.dmg";
// biome-ignore lint/suspicious/noTemplateCurlyInString: electron-builder template vars
const EXE_NAME = "Exegol-${version}-${arch}.exe";
// biome-ignore lint/suspicious/noTemplateCurlyInString: electron-builder template vars
const APPIMAGE_NAME = "Exegol-${version}-${arch}.AppImage";

const config: Configuration = {
  appId: "com.exegol.desktop",
  productName: "Exegol",
  copyright: "Copyright 2026 Exegol",

  directories: {
    output: "dist",
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
    notarize: false, // Enable when Apple credentials are configured
    entitlements: "src/resources/build/entitlements.mac.plist",
    entitlementsInherit: "src/resources/build/entitlements.mac.inherit.plist",
    darkModeSupport: true,
    extendInfo: {
      NSAppleEventsUsageDescription:
        "Exegol needs automation access to open IDEs and manage terminals.",
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
  linux: {
    icon: resolve(iconPath, "icon.png"),
    target: [{ target: "AppImage", arch: ["x64"] }],
    category: "Development",
    artifactName: APPIMAGE_NAME,
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
