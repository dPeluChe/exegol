import type { Configuration } from "electron-builder";
import { resolve } from "node:path";

const iconPath = resolve("src/resources/build/icons");

const config: Configuration = {
  appId: "com.exegol.desktop",
  productName: "Exegol",
  copyright: "Copyright 2026 Exegol",

  // Directories
  directories: {
    output: "dist",
    buildResources: "src/resources/build",
  },

  // Use electron-vite output
  files: [
    "out/**/*",
    "!out/**/*.map",
    "package.json",
  ],

  // ASAR with unpacking for native modules
  asar: true,
  asarUnpack: [
    "node_modules/node-pty/**",
    "node_modules/libsql/**",
    "node_modules/@libsql/**",
    "node_modules/@neon-rs/**",
    "node_modules/@exegol/core-rust/**",
    "node_modules/bindings/**",
    "node_modules/file-uri-to-path/**",
    "node_modules/better-sqlite3/**",
  ],

  // Extra files to include outside ASAR (native .node bindings at workspace level)
  extraResources: [
    {
      from: "../../packages/core-rust/core-rust.*.node",
      to: "core-rust/",
      filter: ["**/*.node"],
    },
  ],

  // Generate update manifests for all channels
  generateUpdatesFilesForAllChannels: true,

  // ─── macOS ──────────────────────────────────────────────────────────
  mac: {
    icon: resolve(iconPath, "icon.icns"),
    category: "public.app-category.developer-tools",
    target: "default", // DMG + ZIP
    hardenedRuntime: true,
    gatekeeperAssess: false,
    notarize: false, // Enable when Apple credentials are configured
    entitlements: "src/resources/build/entitlements.mac.plist",
    entitlementsInherit: "src/resources/build/entitlements.mac.inherit.plist",
    darkModeSupport: true,
    extendInfo: {
      NSAppleEventsUsageDescription: "Exegol needs automation access to open IDEs and manage terminals.",
    },
  },

  dmg: {
    artifactName: "Exegol-${version}-${arch}.dmg",
    contents: [
      { x: 130, y: 220 },
      { x: 410, y: 220, type: "link", path: "/Applications" },
    ],
  },

  // ─── Windows ────────────────────────────────────────────────────────
  win: {
    icon: resolve(iconPath, "icon.ico"),
    target: [{ target: "nsis", arch: ["x64"] }],
    artifactName: "Exegol-${version}-${arch}.exe",
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
    artifactName: "Exegol-${version}-${arch}.AppImage",
  },

  // ─── Auto-update publish config (GitHub Releases) ──────────────────
  publish: {
    provider: "github",
    owner: "OWNER", // TODO: replace with actual GitHub owner
    repo: "exegol", // TODO: replace with actual repo name
    releaseType: "release",
  },
};

export default config;
