/**
 * Exegol CLI — query agents, projects, and search from the terminal.
 *
 * Reads the same SQLite database that the Electron app uses (read-only).
 * For commands that need the PTY sidecar (logs, spawn), the CLI connects
 * to ~/.exegol/pty-sidecar.sock via JSON-RPC.
 *
 * Usage:
 *   exegol status          List active agents
 *   exegol projects        List projects
 *   exegol search <query>  Semantic search (requires project indexing)
 *   exegol help            Show this help
 */

import { closeDb } from "./db";
import { projectsCommand } from "./commands/projects";
import { searchCommand } from "./commands/search";
import { statusCommand } from "./commands/status";

const VERSION = "0.4.0";

function showHelp(): void {
  console.log(`
  \x1b[1mExegol CLI\x1b[0m v${VERSION}

  \x1b[4mUsage:\x1b[0m
    exegol <command> [args]

  \x1b[4mCommands:\x1b[0m
    status              List active agents across all projects
    projects            List all projects with agent counts
    search <query>      Semantic search over the project codebase
    help                Show this help message
    version             Show version

  \x1b[4mExamples:\x1b[0m
    exegol status
    exegol projects
    exegol search "how does authentication work"
`);
}

function main(): void {
  const args = process.argv.slice(2);
  const command = args[0];

  try {
    switch (command) {
      case "status":
        statusCommand();
        break;
      case "projects":
        projectsCommand();
        break;
      case "search":
        searchCommand(args.slice(1).join(" "));
        break;
      case "version":
      case "--version":
      case "-v":
        console.log(`exegol v${VERSION}`);
        break;
      case "help":
      case "--help":
      case "-h":
      case undefined:
        showHelp();
        break;
      default:
        console.error(`Unknown command: ${command}`);
        showHelp();
        process.exit(1);
    }
  } finally {
    closeDb();
  }
}

main();
