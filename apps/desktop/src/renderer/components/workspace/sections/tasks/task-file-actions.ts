import { parseTaskBoard } from "../../../../lib/markdown-tasks";
import { trpcInvoke } from "../../../../lib/trpc-client";

interface WriteFileMutation {
  mutateAsync: (args: { path: string; content: string }) => Promise<unknown>;
}

interface ArchiveArgs {
  content: string;
  filePath: string;
  projectPath: string;
  writeFile: WriteFileMutation;
}

/** Archive all completed tasks to docs/tasks_completed.md, return the new TODO content. */
export async function archiveCompletedTasks({
  content,
  filePath,
  projectPath,
  writeFile,
}: ArchiveArgs): Promise<string | null> {
  const parsedBoard = parseTaskBoard(content, filePath);
  const allTasks = Object.values(parsedBoard.columns).flat();
  const completed = allTasks.filter((t) => t.completed);
  if (completed.length === 0) return null;

  const date = new Date().toISOString().split("T")[0];
  const archiveLines = completed.map((t) => `- [x] ${t.text}`).join("\n");
  const archiveEntry = `\n## Archived ${date}\n${archiveLines}\n`;

  const archivePath = `${projectPath}/docs/tasks_completed.md`;
  try {
    const existing = await trpcInvoke<{ content: string }>("files.readFile", {
      path: archivePath,
    });
    await writeFile.mutateAsync({
      path: archivePath,
      content: `${existing.content}${archiveEntry}`,
    });
  } catch {
    await writeFile.mutateAsync({
      path: archivePath,
      content: `# Completed Tasks\n${archiveEntry}`,
    });
  }

  const sortedLines = completed.map((t) => t.line).sort((a, b) => b - a);
  const lines = content.split("\n");
  for (const line of sortedLines) {
    lines.splice(line, 1);
  }
  return lines.join("\n");
}

interface CreateTodoArgs {
  projectName: string;
  projectPath: string;
  writeFile: WriteFileMutation;
}

/** Create a new docs/TODO.md template file for the project, return its path. */
export async function createTodoFile({
  projectName,
  projectPath,
  writeFile,
}: CreateTodoArgs): Promise<string> {
  const todoPath = `${projectPath}/docs/TODO.md`;
  const template = `# ${projectName} — Task Board

## Backlog
- [ ] Define project requirements
- [ ] Setup development environment

## Todo

## In Progress

## Validated

## Done

---
> Managed by Exegol. Move tasks between sections to update status.
> Tags: #feature #bug #refactor #docs | Priority: !high !medium !low | Agent: @claude-code
`;
  // Ensure docs/ directory exists
  try {
    await trpcInvoke("files.writeFile", { path: `${projectPath}/docs/.gitkeep`, content: "" });
  } catch {
    /* dir may already exist */
  }
  await writeFile.mutateAsync({ path: todoPath, content: template });
  return todoPath;
}
