# Exegol

[English](README.md) · **Español**

App de escritorio para correr agentes de IA para código lado a lado. Claude Code, Codex, Gemini,
Aider o cualquier agente de línea de comandos, cada uno en su propia terminal, con su estado en
vivo, un solo lugar para ver quién te necesita y herramientas para pasar trabajo entre ellos.

![Electron](https://img.shields.io/badge/Electron-41-47848F?logo=electron&logoColor=white)
![React](https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=white)
![Rust](https://img.shields.io/badge/Rust-napi--rs-DEA584?logo=rust&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-5.7-3178C6?logo=typescript&logoColor=white)
![License](https://img.shields.io/badge/License-MIT-green)

> La documentación detallada está en inglés; los enlaces de esta página llevan a esa versión.

## ¿Qué es Exegol?

Las herramientas de IA para código suelen ser solo de terminal (potentes, pero pierdes la pista
de cinco sesiones en cinco ventanas) o plataformas cerradas atadas a un proveedor. Exegol es el
centro de mando entre ambas: sigues usando los CLIs que ya conoces y tienes una sola ventana para
lanzarlos, vigilarlos y coordinarlos.

> **El nombre.** Exegol es el mundo Sith oculto en las Regiones Desconocidas de Star Wars (*El
> ascenso de Skywalker*): la ciudadela donde los Sith Eternos conspiraban en secreto y armaron la
> flota de la Orden Final. Aquí es el lugar desde donde planeas el ataque, despliegas a tus agentes
> y mantienes toda la flota bajo control.

## Lo principal

- **Cualquier agente**: 14 CLIs integrados más los tuyos; cada uno corre en una terminal real.
- **Muchos a la vez**: pestañas y paneles divididos por proyecto, un Dashboard de todos los
  proyectos y sesiones fijadas que ves en vivo lado a lado.
- **Sabes quién te necesita**: estado en vivo, una lista de Needs attention, notificaciones con la
  pregunta pendiente y `Cmd+J` para ir a la siguiente.
- **Sesiones que sobreviven**: los agentes siguen corriendo tras recargar, un crash o una
  actualización.
- **Coordinación**: manda texto de un agente a otro, memoria compartida, mensajes y reserva de
  archivos entre agentes, y pipelines que encadenan agentes con ciclos de revisión.
- **Alrededor del código**: panel de navegador con modo diseño y grabación de QA, diff de git, un
  botón inteligente de commit/push/PR y deshacer los cambios de un agente.

Todas las funciones: [docs/GUIDES/FEATURES.md](docs/GUIDES/FEATURES.md) ·
Atajos de teclado: [docs/GUIDES/KEYBOARD_SHORTCUTS.md](docs/GUIDES/KEYBOARD_SHORTCUTS.md)
(las teclas aquí son de macOS; en Linux y Windows `Cmd` es `Ctrl+Shift`)

## Instalar

Descarga la última versión desde
[GitHub Releases](https://github.com/dPeluChe/exegol/releases/latest): un DMG notarizado para
macOS (Apple Silicon), un AppImage o `.deb` para Linux. La app se actualiza sola desde ahí.

## Correr desde el código

Requisitos: [Bun](https://bun.sh/) 1.2+, [Rust](https://rustup.rs/),
[Node.js](https://nodejs.org/) 20+ (CI usa 22) y al menos un CLI de agente instalado (`claude`,
`codex`, `aider`, `gemini`...).

```bash
git clone https://github.com/dPeluChe/exegol.git
cd exegol
bun install
bun run rebuild:native   # módulo nativo de Rust + node-pty para Electron
bun run dev
```

Se abre la ventana de la app. Agrega un proyecto (cualquier carpeta o repo de git) y lanza un
agente. Para generar el instalador de macOS y publicar versiones:
[docs/GUIDES/RELEASE.md](docs/GUIDES/RELEASE.md).

## Colaborar

Empieza por [CONTRIBUTING.md](CONTRIBUTING.md): instalación, dónde encontrar trabajo, el ciclo de
una tarea por PR y las reglas fáciles de pasar por alto. Los agentes de IA que trabajan en este
repo siguen [AGENTS.md](AGENTS.md). La arquitectura está en [CLAUDE.md](CLAUDE.md).

## Documentación

| Documento | Descripción |
|-----------|-------------|
| [Features](docs/GUIDES/FEATURES.md) | Todo lo que hace la app, por área |
| [Keyboard shortcuts](docs/GUIDES/KEYBOARD_SHORTCUTS.md) | Atajos de la app y de la terminal |
| [CONTRIBUTING.md](CONTRIBUTING.md) | Cómo colaborar |
| [AGENTS.md](AGENTS.md) | Reglas para agentes de IA en este repo |
| [CLAUDE.md](CLAUDE.md) | Arquitectura y comandos de desarrollo |
| [docs/README.md](docs/README.md) | Índice de la documentación |
| [CHANGELOG.md](docs/CHANGELOG.md) | Novedades por versión |
| [Task Board](docs/TASK_TODO.md) | Trabajo pendiente |

## Licencia

[MIT](LICENSE)
