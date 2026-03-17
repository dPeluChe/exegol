import { useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { X, FolderSearch } from 'lucide-react'
import { Button, Input } from '@exegol/ui'
import { useCreateProject } from '../../hooks/use-trpc'
import { useAppStore } from '../../stores/app'

interface AddProjectDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

function deriveProjectName(folderPath: string): string {
  const segments = folderPath.replace(/\\/g, '/').split('/').filter(Boolean)
  return segments[segments.length - 1] ?? 'Untitled'
}

export function AddProjectDialog({ open, onOpenChange }: AddProjectDialogProps) {
  const [folderPath, setFolderPath] = useState('')
  const [projectName, setProjectName] = useState('')
  const [defaultBranch, setDefaultBranch] = useState('main')

  const createProject = useCreateProject()
  const setActiveProject = useAppStore((s) => s.setActiveProject)

  const handleBrowse = async () => {
    try {
      // Use Electron dialog via IPC (exposed through preload)
      const result = await window.api.dialog.showOpenDialog({
        properties: ['openDirectory'],
        title: 'Select Project Folder',
      })
      if (result && !result.canceled && result.filePaths?.[0]) {
        const selected = result.filePaths[0]
        setFolderPath(selected)
        if (!projectName) {
          setProjectName(deriveProjectName(selected))
        }
      }
    } catch {
      // Dialog not available in dev, user can type manually
    }
  }

  const handlePathChange = (value: string) => {
    setFolderPath(value)
    if (!projectName || projectName === deriveProjectName(folderPath)) {
      setProjectName(deriveProjectName(value))
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!folderPath.trim() || !projectName.trim()) return

    try {
      const project = await createProject.mutateAsync({
        name: projectName.trim(),
        path: folderPath.trim(),
        gitRemote: null,
        defaultBranch: defaultBranch || 'main',
        defaultIde: 'vscode',
      })

      setActiveProject(project.id)

      // Reset form
      setFolderPath('')
      setProjectName('')
      setDefaultBranch('main')
      onOpenChange(false)
    } catch {
      // Error handled by mutation state
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/60" />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-lg border p-6 shadow-2xl"
          style={{
            background: 'var(--bg-secondary)',
            borderColor: 'var(--border)',
          }}
        >
          <div className="mb-4 flex items-center justify-between">
            <Dialog.Title
              className="text-base font-semibold"
              style={{ color: 'var(--text-primary)' }}
            >
              Add Project
            </Dialog.Title>
            <Dialog.Close asChild>
              <button
                className="flex h-6 w-6 items-center justify-center rounded transition-colors hover:bg-white/10"
                style={{ color: 'var(--text-muted)' }}
              >
                <X className="h-4 w-4" />
              </button>
            </Dialog.Close>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Folder Path */}
            <div className="space-y-1.5">
              <label
                className="text-xs font-medium"
                style={{ color: 'var(--text-secondary)' }}
              >
                Project Folder
              </label>
              <div className="flex gap-2">
                <Input
                  value={folderPath}
                  onChange={(e) => handlePathChange(e.target.value)}
                  placeholder="/path/to/your/project"
                  className="flex-1 border-[var(--border)] bg-[var(--bg-tertiary)] text-[var(--text-primary)]"
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleBrowse}
                  className="shrink-0 border-[var(--border)] text-[var(--text-secondary)] hover:bg-white/5"
                >
                  <FolderSearch className="h-4 w-4" />
                </Button>
              </div>
              <p className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
                Must be a git repository
              </p>
            </div>

            {/* Project Name */}
            <div className="space-y-1.5">
              <label
                className="text-xs font-medium"
                style={{ color: 'var(--text-secondary)' }}
              >
                Project Name
              </label>
              <Input
                value={projectName}
                onChange={(e) => setProjectName(e.target.value)}
                placeholder="my-project"
                className="border-[var(--border)] bg-[var(--bg-tertiary)] text-[var(--text-primary)]"
              />
            </div>

            {/* Default Branch */}
            <div className="space-y-1.5">
              <label
                className="text-xs font-medium"
                style={{ color: 'var(--text-secondary)' }}
              >
                Default Branch
              </label>
              <Input
                value={defaultBranch}
                onChange={(e) => setDefaultBranch(e.target.value)}
                placeholder="main"
                className="border-[var(--border)] bg-[var(--bg-tertiary)] text-[var(--text-primary)]"
              />
            </div>

            {/* Error */}
            {createProject.isError && (
              <p className="text-xs" style={{ color: 'var(--error)' }}>
                Failed to add project:{' '}
                {createProject.error instanceof Error
                  ? createProject.error.message
                  : 'Unknown error'}
              </p>
            )}

            {/* Submit */}
            <div className="flex justify-end gap-2 pt-2">
              <Button
                type="button"
                variant="ghost"
                onClick={() => onOpenChange(false)}
                className="text-[var(--text-secondary)]"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={!folderPath.trim() || !projectName.trim() || createProject.isPending}
                className="text-white"
                style={{ background: 'var(--accent)' }}
              >
                {createProject.isPending ? 'Adding...' : 'Add Project'}
              </Button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
