# Internal Mail System Plan

## Summary
Build a new internal mail subsystem that supports:
- player-to-player mail with threaded conversations
- system-to-player mail in the same inbox
- a topbar mail popover as the primary v1 UI
- per-user unread counts stored server-side and surfaced through `appShell`

Chosen defaults:
- no attachments in v1
- recipients searchable by character name
- player mail supports read, reply, and participant-scoped delete
- system mail is non-replyable
- no dedicated `/mail` page in v1

## Key Changes

### 1. Data model and domain
Create a new `mail` domain under `src/domains/mail` and make it the SSOT for schema access, validation, unread-count logic, reply rules, and participant visibility.

Database shape:
- `mail_threads`
  - `id`
  - `kind` enum/text: `player` or `system`
  - `subject`
  - `created_at`
  - `updated_at`
  - `system_key` nullable for future automated mail templates
- `mail_thread_participants`
  - `thread_id`
  - `player_id`
  - `role` enum/text: `sender`, `recipient`, `system_recipient`
  - `last_read_message_created_at` nullable
  - `deleted_at` nullable
  - unique `(thread_id, player_id)`
- `mail_messages`
  - `id`
  - `thread_id`
  - `sender_player_id` nullable for system mail
  - `sender_type` enum/text: `player` or `system`
  - `body`
  - `created_at`

Behavior rules:
- creating player mail creates one thread, two participant rows, and the initial message
- replying appends a `mail_messages` row to an existing thread and updates `mail_threads.updated_at`
- system mail uses the same thread/message tables, with `sender_player_id = null` and `sender_type = system`
- participants only see threads where they have a participant row and `deleted_at is null`
- delete is participant-scoped soft delete by setting `deleted_at`; it never removes the other participant’s copy
- replying is allowed only for `player` threads
- unread count for a participant = threads/messages with at least one message newer than that participant’s `last_read_message_created_at`
- mark-read updates only the current participant row

RLS and RPCs:
- add select/insert/update policies so players can only read/update their own participant rows and their visible threads/messages
- use security-definer RPCs or transactional domain helpers for:
  - `create_player_mail(...)`
  - `reply_to_mail_thread(...)`
  - `mark_mail_thread_read(...)`
  - `delete_mail_thread_for_player(...)`
  - optionally `send_system_mail(...)` for admin/service use
- add the mail tables to `supabase_realtime`

Public domain interfaces:
- `MailThreadPreview`
- `MailThreadDetail`
- `MailMessage`
- `MailRecipientPreview`
- `MailboxData`
- `SendMailInput`
- `ReplyMailInput`

### 2. APIs, hydration, and realtime
Extend the existing authenticated-shell pattern instead of creating isolated local state.

API routes:
- `GET /api/mail`
  - returns mailbox list plus currently selected/open thread detail payload if requested by query param
- `POST /api/mail`
  - creates a new player-to-player thread
- `POST /api/mail/[threadId]/reply`
  - appends a reply for player threads only
- `PATCH /api/mail/[threadId]/read`
  - marks the current thread read for the current player
- `DELETE /api/mail/[threadId]`
  - participant-scoped delete
- `GET /api/mail/recipients?q=...`
  - character-name search for compose recipient picker

App-shell integration:
- add `unreadMailCount` to `AppShellSliceData`
- include it in:
  - authenticated shell loader
  - `/api/app-shell`
  - client `fetchAppShell()`
  - fallback refill in `RealtimeProvider`

Store integration:
- add a `mail` slice to `game-store` containing:
  - `threads`
  - `activeThread`
  - `recipientSearchResults`
- add setters/patchers similar to the existing chat slice
- keep unread mail count in `appShell`, not duplicated inside the mail slice

Realtime:
- subscribe to `mail_threads`, `mail_thread_participants`, and `mail_messages` filtered to the current player’s participant rows where possible
- on relevant inserts/updates:
  - patch thread previews
  - patch active thread messages if open
  - refresh `unreadMailCount` through `fetchAppShell()` or a lightweight mail unread fetch
- retain current fallback polling behavior through the central realtime provider rather than adding per-component polling

### 3. Topbar popover UX
Implement mail inside the topbar as a compact but fully functional mailbox popover, matching the current chat/notification button styling.

Popover structure:
- header with `Mail` title and unread badge
- default split state:
  - left/top list of thread previews
  - right/bottom detail view when a thread is selected
- compose action opens an inline compose panel inside the popover, not a new page
- recipient picker uses debounced character-name search
- thread preview shows:
  - subject
  - counterpart or `System`
  - last message snippet
  - timestamp
  - unread indicator
- thread detail shows message history chronologically
- reply box appears only for `player` threads
- delete action available on thread detail and/or preview
- system mail displays sender as `System` and hides reply UI

Interaction defaults:
- opening the popover does not mark all mail read
- selecting a thread marks only that thread read
- compose success inserts the new thread into the list, opens it, and clears the composer
- participant-deleted threads disappear immediately from that player’s list
- no inbox/archive split in v1
- no sent-only mailbox view in v1; player-created threads remain visible in the unified mailbox unless the current player deletes them

## Test Plan
- Migration tests/verification:
  - create player mail thread with initial message
  - create system mail thread
  - participant-scoped delete hides only one user’s copy
  - mark-read updates only one participant row
  - RLS blocks access to non-participant threads/messages
- API tests:
  - recipient search returns character-name matches only for valid players
  - creating mail rejects self-send and invalid recipient
  - replying to system threads fails
  - deleting a thread removes it from current mailbox responses
- UI/store tests:
  - topbar badge appears from hydrated shell data on initial load
  - new incoming mail increments unread badge without opening the popover
  - opening a specific thread clears its unread badge and persists after refresh
  - player reply updates thread history and ordering
  - system mail renders correctly without reply controls
- Realtime scenarios:
  - player A sends mail to player B; player B sees unread badge and new thread preview live
  - system mail inserted for a player updates unread count live
  - deleting a thread while popover is open removes it cleanly without stale active-thread state

## Assumptions
- `unreadMailCount` is the only mail summary surfaced in `appShell` for v1
- compose recipient search is by character name, while the stored foreign key remains `player_id`
- subject is required for both player and system mail
- system mail is generated through domain/service entrypoints, not a public player-facing API
- v1 intentionally excludes attachments, claim actions, archive state, admin reply routing, and a dedicated mail page
