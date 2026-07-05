import { Button, Input } from "@exegol/ui";
import { FolderSearch } from "lucide-react";
import { useState } from "react";
import { useCreateProject } from "../../../hooks/use-trpc";
import { useAppStore } from "../../../stores/app";

interface FirstProjectStepProps {
  onNext: () => void;
  onBack: () => void;
  onSkip: () => void;
}

function deriveProjectName(folderPath: string): string {
  const segments = folderPath.replace(/\\/g, "/").split("/").filter(Boolean);
  return segments[segments.length - 1] ?? "Untitled";
}

export function FirstProjectStep({ onNext, onBack, onSkip }: FirstProjectStepProps) {
  const [folderPath, setFolderPath] = useState("");
  const [projectName, setProjectName] = useState("");
  const createProject = useCreateProject();
  const setActiveProject = useAppStore((s) => s.setActiveProject);

  const handleBrowse = async () => {
    try {
      const result = await window.api.dialog.showOpenDialog({
        properties: ["openDirectory"],
        title: "Select Project Folder",
      });
      if (result && !result.canceled && result.filePaths?.[0]) {
        const selected = result.filePaths[0];
        setFolderPath(selected);
        if (!projectName) setProjectName(deriveProjectName(selected));
      }
    } catch {
      // Dialog not available in dev, user can type the path manually
    }
  };

  const handleAdd = async () => {
    if (!folderPath.trim() || !projectName.trim()) return;
    try {
      const project = await createProject.mutateAsync({
        name: projectName.trim(),
        path: folderPath.trim(),
        gitRemote: null,
        defaultBranch: "main",
        defaultIde: "vscode",
      });
      setActiveProject(project.id);
      onNext();
    } catch {
      // Surfaced via createProject.isError below
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-base font-semibold text-text-primary">Add your first project</h2>
        <p className="text-xs text-text-muted">Point Exegol at a git repository to get started.</p>
      </div>

      <div className="space-y-1.5">
        <label
          htmlFor="onboarding-project-folder"
          className="text-xs font-medium text-text-secondary"
        >
          Project Folder
        </label>
        <div className="flex gap-2">
          <Input
            id="onboarding-project-folder"
            value={folderPath}
            onChange={(e) => setFolderPath(e.target.value)}
            placeholder="/path/to/your/project"
            className="flex-1 border-[var(--border)] bg-[var(--bg-tertiary)] text-[var(--text-primary)]"
          />
          <Button
            type="button"
            variant="outline"
            onClick={handleBrowse}
            className="shrink-0 border-[var(--border)] text-[var(--text-secondary)]"
          >
            <FolderSearch className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="space-y-1.5">
        <label
          htmlFor="onboarding-project-name"
          className="text-xs font-medium text-text-secondary"
        >
          Project Name
        </label>
        <Input
          id="onboarding-project-name"
          value={projectName}
          onChange={(e) => setProjectName(e.target.value)}
          placeholder="my-project"
          className="border-[var(--border)] bg-[var(--bg-tertiary)] text-[var(--text-primary)]"
        />
      </div>

      {createProject.isError && (
        <p className="text-xs text-error">
          Failed to add project:{" "}
          {createProject.error instanceof Error ? createProject.error.message : "Unknown error"}
        </p>
      )}

      <div className="flex items-center justify-between pt-2">
        <Button type="button" variant="ghost" onClick={onBack} className="text-text-secondary">
          Back
        </Button>
        <div className="flex gap-2">
          <Button type="button" variant="ghost" onClick={onSkip} className="text-text-muted">
            Skip for now
          </Button>
          <Button
            type="button"
            onClick={handleAdd}
            disabled={!folderPath.trim() || !projectName.trim() || createProject.isPending}
            className="bg-accent text-white"
          >
            {createProject.isPending ? "Adding..." : "Add project"}
          </Button>
        </div>
      </div>
    </div>
  );
}
