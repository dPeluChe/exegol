# Exegol

[English](README.md) · **Español**

Una app de escritorio para correr agentes de IA para código lado a lado. Claude Code, Codex,
Gemini, OpenCode, Aider y los CLIs que ya usas, cada uno en una terminal real, con su estado en
vivo, un solo lugar para ver quién te necesita y herramientas para pasar trabajo entre ellos.

[![Última versión](https://img.shields.io/github/v/release/dPeluChe/exegol)](https://github.com/dPeluChe/exegol/releases/latest)
![Plataformas](https://img.shields.io/badge/plataformas-macOS%20%7C%20Linux-informational)
![Licencia](https://img.shields.io/badge/Licencia-MIT-green)

<!--
Capturas: guárdalas en docs/assets/screenshots/ con estos nombres y descomenta las líneas de abajo.
Son las mismas imágenes que usa README.md.
  workspace.png   espacio de trabajo con dos o tres agentes en paneles divididos, uno esperándote
  launcher.png    Launch Agent con "Combination" abierto (roles de modelo y una tarjeta de preset)
  dashboard.png   Dashboard con sesiones fijadas en Watching
  dictation.png   el overlay de dictado sobre un panel de terminal, con texto visible
  preview.png     un panel Files con un archivo HTML en Preview
-->
<!-- ![Agentes en paneles divididos](docs/assets/screenshots/workspace.png) -->

## Qué es

Los CLIs de código son buenos para el trabajo y malos para ser cinco a la vez: cinco ventanas y
ni idea de cuál está esperando una respuesta. Exegol es una sola ventana para todos. Cada CLI se
queda como está (su propia sesión, sus flags y su configuración) y Exegol pone alrededor el
layout, el estado, las notificaciones y la coordinación.

Es para quien ya usa uno o más agentes de código en la terminal y quiere correr varios en
paralelo, en distintos proyectos, sin perderles la pista.

> **El nombre.** Exegol es el mundo Sith oculto de Star Wars (*El ascenso de Skywalker*), donde
> se armó en secreto la flota de la Orden Final. Aquí es donde planeas el trabajo, despliegas a
> tus agentes y tienes a la flota a la vista.

## Funciones

**Espacio de trabajo**
- Proyectos (cualquier carpeta o repo de git) con pestañas y paneles divididos: terminal,
  navegador, archivos, git y un lanzador de agentes.
- Seis layouts predefinidos más los tuyos; cualquier panel de terminal o navegador puede flotar
  en una ventana siempre visible.
- Paleta de comandos (`Cmd+K`) y navegación con teclado entre pestañas, paneles y agentes en
  espera.

**Agentes**
- 14 CLIs integrados más tu propio comando ([tabla abajo](#clis-soportados)).
- Las sesiones sobreviven a una recarga, un crash o una actualización de la app: las terminales
  corren en un proceso aparte y la pantalla se repite cuando la app regresa.
- Estado en vivo por agente (Claude Code por sus hooks, los demás por su salida), una lista de
  Needs attention, notificaciones de escritorio con la pregunta pendiente y `Cmd+J` para ir a la
  siguiente.
- Opciones al lanzar: modelo, nombre de la sesión, modo de acceso (lectura, escritura, plan), un
  worktree de git aislado y roles de modelo para los CLIs que aceptan un segundo modelo (advisor y
  subagentes en Claude Code, Codex, OpenCode, Kilo Code, Aider, Goose, Droid), con presets.
- Retomar sesiones pasadas y reiniciar una sesión con la versión nueva de su CLI cuando ya está
  instalada.

**Dashboard**
- Todos los agentes vivos de todos los proyectos con estado, tiempo activo, tokens y costo.
- Watching: fija sesiones y síguelas como terminales en vivo lado a lado.

**Coordinación**
- Un servidor MCP de Exegol para cada agente: memoria compartida, mensajes entre agentes y
  reserva de archivos para que dos agentes no editen las mismas rutas.
- Pipelines: agentes en secuencia sobre un worktree compartido, con ciclos de revisión y
  corrección y compuertas con evaluador.
- Watch PR: los checks que fallan, los comentarios de revisión y los conflictos del PR del agente
  le llegan de vuelta (requiere `gh`).

**Alrededor del código**
- Panel de git con diff, comentarios por línea y un botón para el siguiente paso (commit, push,
  crear o hacer merge del PR).
- Deshacer el turno de un agente y snapshots de lo que cambiaron los agentes.
- Panel de navegador que los agentes pueden manejar por MCP, limitado a hosts locales y a los que
  tú permitas.
- Panel de archivos con visor Monaco y un Preview sin conexión para Markdown y HTML.

**En tu máquina**
- Dictado por voz (`Cmd+Shift+Space`) transcrito localmente con un modelo que descargas en
  Settings.
- Settings > Storage muestra lo que Exegol guarda en disco y te deja limpiarlo.

La lista completa está en [docs/GUIDES/FEATURES.md](docs/GUIDES/FEATURES.md) y los atajos en
[docs/GUIDES/KEYBOARD_SHORTCUTS.md](docs/GUIDES/KEYBOARD_SHORTCUTS.md) (en inglés). Las teclas
están escritas para macOS; en Linux y Windows `Cmd` es `Ctrl+Shift`.

<!-- ![Launch Agent con roles de modelo](docs/assets/screenshots/launcher.png) -->
<!-- ![Dashboard con sesiones fijadas](docs/assets/screenshots/dashboard.png) -->
<!-- ![Overlay de dictado](docs/assets/screenshots/dictation.png) -->
<!-- ![Preview de HTML en un panel Files](docs/assets/screenshots/preview.png) -->

## CLIs soportados

Exegol lanza los CLIs que tienes instalados; no los incluye ni sus cuentas. Settings > Agent CLIs
muestra cuáles encuentra y cómo instalar los demás.

| CLI | Comando | Prompt al lanzar | Roles de modelo |
|-----|---------|:----------------:|:---------------:|
| Claude Code | `claude` | sí | sí |
| Codex | `codex` | sí | sí |
| Gemini | `gemini` | no | no |
| Antigravity | `agy` | sí | no |
| Devin | `devin` | sí | no |
| Aider | `aider` | no | sí |
| Goose | `goose` | sí | sí |
| OpenCode | `opencode` | no | sí |
| Amp | `amp` | sí | no |
| Kiro | `kiro-cli` | no | no |
| Kilo Code | `kilocode` o `kilo` | no | sí |
| Crush | `crush` | no | no |
| Factory Droid | `droid` | sí | sí |
| Terminal | tu `$SHELL` | no | no |

Cualquier otro comando se agrega como CLI personalizado. Un CLI que escribes en una terminal
normal también se reconoce como agente.

## Instalar

Descarga la última versión desde
[GitHub Releases](https://github.com/dPeluChe/exegol/releases/latest):

| Plataforma | Archivo | Notas |
|------------|---------|-------|
| macOS (Apple Silicon) | `Exegol-<versión>-arm64.dmg` | Firmado y notarizado |
| Linux (x64) | `Exegol-<versión>-x86_64.AppImage` o `exegol_<versión>_amd64.deb` | Compilado en Ubuntu 22.04 |

Todavía no hay versión para Mac con Intel ni para Windows. Ya instalada, la app revisa GitHub
Releases, descarga las actualizaciones y te ofrece reiniciar desde la barra de título, con las
notas de la versión.

**Requisitos**: al menos un CLI de código instalado y con sesión iniciada. Opcional: `gh` (pull
requests, Watch PR), [Ollama](https://ollama.com/) (búsqueda semántica en la memoria) y una API
key de Anthropic (mensajes de commit con IA, calificación de corridas, evaluadores de pipelines).

## Primeros pasos

1. Abre Exegol y sigue la configuración inicial: detecta tus CLIs y corre Doctor, un chequeo de
   salud.
2. Agrega un proyecto: cualquier carpeta o repo de git.
3. En el panel vacío elige un CLI, si quieres un modelo y un worktree, y lánzalo.
4. Divide el panel (`Cmd+D`) y lanza otro agente al lado.
5. Cuando un agente pregunta algo, aparece en Needs attention; `Cmd+J` te lleva ahí.

El tour de bienvenida (paleta de comandos > Show welcome tour) explica el resto.

## Compilar desde el código

Requisitos: [Bun](https://bun.sh/) 1.2.23+, [Node.js](https://nodejs.org/) 20+ (CI usa 22),
[Rust](https://rustup.rs/) estable y git. En Linux también
`build-essential python3 libsecret-1-dev`.

```bash
git clone https://github.com/dPeluChe/exegol.git
cd exegol
bun install
bun run rebuild:native   # módulo nativo de Rust + node-pty para Electron
bun run dev              # compila Rust y abre la app
```

`bun run dev:ui` se salta la compilación de Rust y usa la alternativa en JS. Para generar un
instalador:

```bash
bun run build:rust
bun run package:mac      # o package:linux
```

El DMG queda en `apps/desktop/dist/<versión>/`. Sin `APPLE_KEYCHAIN_PROFILE` no se notariza y
macOS te pide permitirlo (System Settings > Privacy & Security > Open Anyway). Cómo publicar una
versión: [docs/GUIDES/RELEASE.md](docs/GUIDES/RELEASE.md).

## Privacidad

Exegol funciona primero en local. No hay cuenta ni telemetría.

- Tus datos (proyectos, sesiones, memoria, configuración) viven en una base SQLite local y en
  `~/.exegol`.
- El dictado corre en tu máquina: el audio nunca sale de ella ni se guarda. Los modelos se
  descargan solo cuando lo pides, de los releases de sherpa-onnx en GitHub, y se verifican contra
  un SHA-256 fijo.
- Las API keys se cifran con el llavero del sistema (`safeStorage` de Electron). Si el sistema no
  ofrece cifrado, Settings > API Keys y Doctor te lo dicen.
- Tus prompts van de cada CLI a su propio proveedor, igual que sin Exegol.
- Exegol por su cuenta se conecta a: GitHub (actualizaciones y notas de versión), los registros
  de npm y PyPI (versión más nueva de cada CLI), Anthropic con tu sesión de Claude Code, solo
  lectura (el widget de uso del plan), y Anthropic con tu API key solo para las funciones de
  arriba que la necesitan.
- Los reportes de bugs del botón de la barra de título son issues públicos en GitHub. Revisas el
  diagnóstico ya redactado antes de enviar nada; nunca incluye prompts ni salida de los agentes.

## Estado

Exegol está en desarrollo activo (0.5.x) y su autor lo usa a diario. Espera versiones seguidas y
algunos detalles sin pulir. Qué cambió en cada versión: [docs/CHANGELOG.md](docs/CHANGELOG.md).
Qué sigue: [docs/TASK_TODO.md](docs/TASK_TODO.md).

## Colaborar

Empieza por [CONTRIBUTING.md](CONTRIBUTING.md) (tiene una sección en español): instalación, las
validaciones, una tarea por PR y las reglas fáciles de pasar por alto. Los agentes de IA que
trabajan en este repo siguen [AGENTS.md](AGENTS.md); la arquitectura está en
[CLAUDE.md](CLAUDE.md). Lee el [Código de Conducta](CODE_OF_CONDUCT.md) y reporta
vulnerabilidades en privado como dice [SECURITY.md](SECURITY.md).

## Licencia y créditos

[MIT](LICENSE) © Antonio Martinez Quintero.

Hecho con Electron, React, xterm.js, Monaco, libSQL, tRPC y Rust (napi-rs, git2). Reconocimiento
de voz con [sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx); cada modelo de voz muestra su
licencia y créditos en Settings > Models. Los CLIs de agentes pertenecen a sus creadores.
