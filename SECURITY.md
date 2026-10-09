# Security Policy

[Español abajo](#en-español)

## Supported versions

Only the latest release gets security fixes. Installed apps update themselves from
[GitHub Releases](https://github.com/dPeluChe/exegol/releases/latest).

## Reporting a vulnerability

Please do not open a public issue, discussion or pull request for a vulnerability.

Report it privately through GitHub:
[Security > Report a vulnerability](https://github.com/dPeluChe/exegol/security/advisories/new).
If that form is not available, email antonio@dpeluche.dev with "Exegol security" in the subject.

Include what you can:

- the app version (Exegol > About Exegol on macOS) and the OS
- what an attacker can do and what they need first (a malicious repo, a web page in a browser
  pane, another local user...)
- steps to reproduce or a proof of concept

Do not include real API keys, prompts, agent output or private paths; redact them.

You can expect a first reply within a week. Once a fix ships, the release notes credit you unless
you prefer otherwise.

## Scope

In scope: the Exegol app and its code in this repo, for example IPC validation, the PTY sidecar
and its socket, the Exegol MCP server and agent tokens, the agent browser's host limits, the
Files HTML preview, update and model downloads, and secrets leaking into logs or bug reports.

Out of scope: vulnerabilities in the agent CLIs Exegol launches (Claude Code, Codex and the
rest) or in their providers; report those to their makers.

## En español

No abras un issue público para una vulnerabilidad. Repórtala en privado desde
[Security > Report a vulnerability](https://github.com/dPeluChe/exegol/security/advisories/new)
o, si ese formulario no está disponible, por correo a antonio@dpeluche.dev con "Exegol security"
en el asunto. Incluye la versión, el sistema operativo, el impacto y cómo reproducirlo, sin API
keys, prompts ni salida de agentes. Solo la última versión recibe correcciones de seguridad.
