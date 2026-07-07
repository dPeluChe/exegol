# T25 — Inter-Agent Messaging (SQLite Mail)

## Inspiration Source
- **Repo**: Overstory (`github.com/jayminwest/overstory`)
- **Files studied**: `src/mail/store.ts`, `src/mail/client.ts`, `src/types.ts`
- **Pattern applied**: Two-layer Store/Client split (thin CRUD + higher-level semantics). WAL mode for multi-process access. Typed message types with CHECK constraint. Thread linking via thread_id.
- **Repo**: Stoneforge (`github.com/stoneforge-ai/stoneforge`)
- **Files studied**: `apps/quarry-web/src/api/hooks/useMessages.ts`, `VirtualizedChatList.tsx`
- **Pattern applied**: Fetch all messages up-front + virtual scrolling. latestMessageId as change detector.
- **Repo**: Mission Control (`github.com/builderz-labs/mission-control`)
- **Files studied**: `src/app/api/chat/messages/route.ts`, `src/components/panels/chat-panel.tsx`
- **Pattern applied**: conversation_id prefix convention, message_type enum (text/status/tool_call), SSE broadcast for real-time.

## What Changed
- **NEW** `apps/desktop/src/main/db/queries/messages.ts` — sendMessage, listMessages, listMessagesBetween, markRead, markAllRead, countUnread
- **NEW** `apps/desktop/src/main/ipc/procedures/messages.ts` — tRPC router: send, list, conversation, markRead, markAllRead, unreadCount
- **NEW** `apps/desktop/src/renderer/components/workspace/sections/MessagesSection.tsx` — Messages tab with compose dialog, message list, type badges, mark-as-read
- **MODIFIED** `apps/desktop/src/main/ipc/router.ts` — registered `messagesRouter` and `queueRouter`
- **MODIFIED** `apps/desktop/src/main/db/queries.ts` — added messages barrel export
- **MODIFIED** `apps/desktop/src/renderer/components/workspace/WorkspaceTabs.tsx` — added "Messages" and "Queue" tabs
- **MODIFIED** `apps/desktop/src/renderer/components/workspace/WorkspaceView.tsx` — added MessagesSection and QueueSection rendering
- **NEW** Migration 014: `messages` table with indexes on to_agent/from_agent

## Architecture Decisions
- **Five typed message types** (text, handoff, status, request, result) rather than free-form: enables UI filtering and semantic routing
- **Nullable from/to agent IDs**: allows system/orchestrator messages (from=null) and broadcast messages (to=null)
- **Polling with 5s interval** rather than IPC push: simpler for v1, can be upgraded to push with the same pattern as T17
- **Separate from chat**: messages are inter-agent coordination, not user-facing chat. User interacts via the compose dialog as "orchestrator"

## How to Test
- Go to the Messages workspace tab
- Click "New Message" to compose an inter-agent message
- Messages appear in the list with type badges and timestamps
- Click the mail icon to mark individual messages as read
- Messages with unread status have an accent border
