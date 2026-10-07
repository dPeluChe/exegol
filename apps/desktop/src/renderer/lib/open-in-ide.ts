import { toastError } from "../stores/toasts";
import { runCommandInNewTab } from "./spawn-shell";
import { trpcMutate } from "./trpc-client";

/** A terminal editor (Neovim, Vim) comes back as a command for a new terminal tab */
export function runIdeResult(projectId: string | undefined, result: { terminalCommand?: string }) {
  if (projectId && result.terminalCommand) {
    runCommandInNewTab(projectId, result.terminalCommand).catch(toastError("Could not open"));
  }
}

/** The project in its IDE (Edit project's, else Settings'), or one of its files at a line */
export function openProjectInIde(data: { projectId: string; file?: string; line?: number }) {
  trpcMutate<{ terminalCommand?: string }>("projects.openInIde", data)
    .then((result) => runIdeResult(data.projectId, result))
    .catch(toastError("Could not open the IDE"));
}
