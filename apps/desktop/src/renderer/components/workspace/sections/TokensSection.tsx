import { Coins } from 'lucide-react'
import { EmptyState } from '../../common/EmptyState'

export function TokensSection() {
  return (
    <div className="flex h-full flex-col items-center justify-center">
      <div className="mb-2 rounded-full bg-accent/10 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-accent">
        Coming Soon
      </div>
      <EmptyState
        icon={<Coins className="h-8 w-8 text-text-muted" />}
        title="Token Usage"
        description="Monitor token consumption and costs across agents. Track 30-day rolling history."
        action={{ label: 'Coming in Phase 2', onClick: () => {} }}
      />
    </div>
  )
}
