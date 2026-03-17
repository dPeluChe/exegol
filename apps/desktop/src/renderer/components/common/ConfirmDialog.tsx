import * as Dialog from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import { Button, cn } from '@exegol/ui'

interface ConfirmDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description: string
  confirmLabel?: string
  cancelLabel?: string
  variant?: 'default' | 'destructive'
  onConfirm: () => void
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  variant = 'default',
  onConfirm,
}: ConfirmDialogProps) {
  const handleConfirm = () => {
    onConfirm()
    onOpenChange(false)
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/60" />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 z-50 w-full max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-lg border p-6 shadow-2xl"
          style={{
            background: 'var(--bg-secondary)',
            borderColor: 'var(--border)',
          }}
        >
          <div className="mb-2 flex items-center justify-between">
            <Dialog.Title
              className="text-base font-semibold"
              style={{ color: 'var(--text-primary)' }}
            >
              {title}
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

          <Dialog.Description
            className="mb-6 text-sm leading-relaxed"
            style={{ color: 'var(--text-secondary)' }}
          >
            {description}
          </Dialog.Description>

          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              onClick={() => onOpenChange(false)}
              className="border"
              style={{
                borderColor: 'var(--border)',
                color: 'var(--text-secondary)',
              }}
            >
              {cancelLabel}
            </Button>
            <Button
              onClick={handleConfirm}
              className={cn('text-white', variant === 'destructive' && 'hover:opacity-90')}
              style={{
                background: variant === 'destructive' ? 'var(--error)' : 'var(--accent)',
              }}
            >
              {confirmLabel}
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
