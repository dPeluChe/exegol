export function RecentSessions() {
  // TODO: Replace with real DB query for past agent sessions
  return (
    <div className="px-3 py-2">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-text-muted">
          Recent Sessions
        </span>
      </div>
      <p className="text-[10px] italic text-text-muted">
        Past agent sessions will appear here
      </p>
    </div>
  )
}
