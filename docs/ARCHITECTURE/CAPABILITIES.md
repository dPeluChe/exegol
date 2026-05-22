# Capability Allowlist (T119)

Inspired by Tauri capabilities (`crynta/terax-ai/src-tauri/capabilities/default.json`).

## Threat model

The renderer process loads our own bundle plus, via the browser pane `<webview>`,
arbitrary user-supplied URLs. The `<webview>` is its own `webContents` and does
not inherit our preload bridge, but a renderer-side XSS — e.g. a vulnerable
markdown viewer rendering attacker-controlled scoring output — would otherwise
have the full preload surface to play with.

The capability allowlist bounds that blast radius. An XSS in the renderer can
only reach tRPC procedures and raw IPC channels explicitly declared in
`apps/desktop/src/preload/capabilities.json`. Anything else throws
`Capability denied: <path>` and surfaces naturally via TanStack Query.

## Layers

There are **two** independent enforcement points. Both must list a capability
for the call to succeed.

1. **Preload** (`apps/desktop/src/preload/index.ts`) — gates every
   `ipcRenderer.invoke / send / on` behind a lookup in `capabilities.json`.
   This is the first wall. A compromised renderer can only call channels the
   preload allows.
2. **Main** (`apps/desktop/src/main/ipc/trpc-ipc.ts`) — re-checks every
   incoming `trpc` invoke against the same `capabilities.json`. This is the
   second wall. A compromised preload (e.g. a malicious update to a dep that
   ends up in the bundle) cannot reach a tRPC procedure not on the list.

Both layers share the same JSON file, loaded statically at build time via
ES-module JSON import, so they cannot drift.

## File format

```jsonc
{
  "trpc": {
    "<router>": "*" | ["<procedure>", ...],
    // "*" → every procedure under this router is allowed.
  },
  "ipc": [
    "<channel>",
    // every raw IPC channel the preload may forward.
  ]
}
```

Today every router maps to `"*"` — the initial allowlist mirrors the surface
the renderer already calls, so this PR adds the gate without changing
behavior. Tightening to per-procedure lists is a JSON edit; the call-site
checks are already in place.

## Adding a new capability

When wiring a new feature that needs a new IPC channel or tRPC router:

1. Add the channel name to `ipc` (or the router name to `trpc` with `"*"`)
   in `apps/desktop/src/preload/capabilities.json`.
2. Restart the app — the JSON is bundled at preload-build time.
3. If you forget step 1, the call throws `Capability denied: <name>` with a
   warning in both the renderer DevTools Console and the main-process log.

## Trade-offs

- Wildcards (`"*"`) keep the diff small but offer less per-call protection.
  Roll them back to explicit procedure arrays as the surface stabilizes.
- The allowlist is a static JSON, not a runtime API. This is intentional —
  capabilities should be reviewable in the diff, not added dynamically.
- The `frame-src *` CSP directive in `apps/desktop/src/renderer/index.html`
  remains permissive because the browser pane is the product. The
  capability allowlist exists precisely because the CSP cannot constrain
  that surface; see the inline CSP comment for the full rationale.
