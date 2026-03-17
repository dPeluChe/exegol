/**
 * Recent agent sessions across all projects.
 * Content for the collapsible sidebar section.
 * Will be populated from SQLite in Phase 2.
 */
export function RecentSessions() {
  // TODO: Replace with real DB query for past agent sessions
  // const { data: sessions } = useRecentSessions()

  return (
    <div>
      <p className="text-[10px] italic text-text-muted">
        Past agent sessions will appear here
      </p>
      {/* Future: list of recent sessions like:
        <div className="space-y-0.5">
          {sessions.map(s => (
            <button key={s.id} className="flex w-full items-center gap-1.5 rounded px-1 py-0.5 text-[10px] text-text-muted hover:bg-white/5">
              <span className="flex-1 truncate">{s.taskDescription}</span>
              <span className="shrink-0 text-[9px]">{formatRelativeTime(s.endedAt)}</span>
            </button>
          ))}
        </div>
      */}
    </div>
  )
}
