You are refactoring a Next.js + Supabase multiplayer browser game to eliminate polling and repeated server fetches across all authenticated pages. The goal is to move to a "hydrate once, subscribe to changes, update locally" architecture. The app is deployed on Vercel and uses Supabase for the database, auth, and Realtime.

Current Problem
The app currently re-fetches data from the server constantly: 5-second chat polling, 15-second manufacturing polling, 5-second travel router.refresh(), 30-second page auto-refreshes, and composite queries that re-run on every navigation. This results in 4,600+ edge requests and 4,300+ function invocations over 6 hours with only 5 players. Pages like the dashboard take 1.47 seconds to load because they query multiple tables on every server render.
Target Architecture
First load: Server components render normally, query Supabase, and return HTML. This does not change. SSR stays for initial page load and hydration.
After hydration: A global client-side state store (Zustand) holds all player-scoped game data. Supabase Realtime subscriptions keep that store updated via WebSocket. Components read from the store, not from server data or API fetches. Pages render near-instantly on client-side navigation because data is already in memory.
Mutations: When a player takes an action (buy, hire, transfer, produce, etc.), the client calls the existing API route, optimistically updates the local store immediately, and then reconciles when the Realtime event confirms the change or the API response returns.
Fallback: If the Realtime WebSocket disconnects, fall back to a single slow poll (60-second interval) that refreshes the full store. When the connection recovers, stop the fallback poll.

Step 1: Create the Global Game Store
Create a Zustand store at src/stores/game-store.ts that holds all player-scoped data in a single normalized structure. The store should contain slices for:

player: current player profile, city, cash, stats
businesses: array of the player's businesses with their details, upgrades, employees, production slots, manufacturing lines, store shelves
banking: accounts, transactions, active loans
inventory: player's inventory items
market: current market listings (both the player's own and the public listings visible to them)
contracts: the player's contracts (sent, received, active)
employees: all of the player's employees with assignment status
production: active manufacturing jobs and their progress
travel: current travel status (traveling or not, ETA, destination)
chat: recent chat messages
appShell: notifications, unread counts, online players, presence data

Each slice should have:

The data itself
A set function that replaces the data
A patch function that merges partial updates (for when a Realtime event sends a single row change)
A lastUpdated timestamp

Export typed selectors for each slice so components can subscribe to only the data they need without re-rendering on unrelated changes.

Step 2: Create the Hydration Bridge
Create a provider component at src/providers/game-hydration-provider.tsx that:

Wraps the authenticated layout's children.
On mount, reads the server-rendered initial data that was fetched by the existing server components and page queries. You can pass this data as props from the server layout/page into a client component boundary, or use the existing React Query cache if populated during SSR.
Calls the store's set functions to populate every slice with the initial server data.
Sets a hydrated flag in the store to true.
Until hydrated is true, components should show their existing loading states. After hydration, they read from the store.

Important: Do not duplicate the initial data fetch. The server components that already query Supabase on first render should pass their results into this provider. Do not add new API calls for hydration.

Step 3: Create the Realtime Subscription Manager
Create a provider component at src/providers/realtime-provider.tsx that:

Mounts inside the authenticated layout, after the hydration provider.
Fetches a Supabase Realtime auth token once (consolidating the duplicate /api/realtime-auth calls from Topbar and AuthenticatedShellDataLayer into this single location).
Opens Supabase Realtime channels scoped to the current player. The subscriptions should be:

Player channel: subscribes to changes on the players table filtered by the current player's ID. Updates the player slice on any change.
Businesses channel: subscribes to changes on businesses filtered by owner_id = current_player_id. On insert/update/delete, patches the businesses slice.
Employees channel: subscribes to employees filtered by player_id. Patches the employees slice.
Banking channel: subscribes to bank_accounts and transactions filtered by player ID. Patches the banking slice.
Inventory channel: subscribes to inventory (or whatever the table is named) filtered by player ID. Patches the inventory slice.
Production channel: subscribes to manufacturing_jobs and related production tables filtered by the player's business IDs. Patches the production slice.
Market channel: subscribes to market_listings. Since market data is shared across players, this listens for all changes. Patches the market slice.
Contracts channel: subscribes to contracts where the player is either sender or receiver. Patches the contracts slice.
Chat channel: subscribes to the chat messages table for inserts. Appends new messages to the chat slice.
Travel channel: subscribes to changes on the player's travel status. Patches the travel slice.


Tracks connection status with a connectionStatus state: connecting, connected, disconnected.
Exposes the connection status to the store so components and the fallback poll can read it.
On unmount (logout or navigation away from authenticated area), cleanly unsubscribes from all channels.

Important: Check the actual table names and foreign key column names in the codebase before writing the subscriptions. Use the existing Supabase client setup — do not create a new client instance.

Step 4: Create the Fallback Poll
Inside the Realtime provider, add a fallback mechanism:

When connectionStatus is disconnected for more than 5 seconds, start a single poll that fetches all player data (reusing the existing composite query functions or API routes) every 60 seconds and repopulates the store.
When the Realtime connection recovers, stop the fallback poll immediately.
This is a safety net only. It should not run during normal operation.


Step 5: Add Optimistic Mutation Helpers
Create a utility at src/stores/optimistic.ts that provides a pattern for optimistic updates:
1. Snapshot the current store state for the affected slice
2. Immediately apply the expected change to the store
3. Call the API route
4. If the API returns an error, roll back to the snapshot
5. If the API succeeds, do nothing — the Realtime event will confirm the change, or the API response data can be used to reconcile
This does not need to be complex. A simple helper that takes a slice name, an optimistic update function, and an API call function is sufficient. The key behaviors are: UI updates instantly, errors roll back, and the Realtime subscription is the ultimate source of truth.

Step 6: Refactor Every Authenticated Page to Read from the Store
Go through each page and component listed below. For each one, remove server-side data fetching on client navigations and polling, and replace data reads with store selectors. Keep the initial server render intact for first load — only change what happens after hydration.
Dashboard (src/app/(authenticated)/dashboard/page.tsx):

Keep the server component for initial render.
The client component should read from the store's player, businesses, banking, and employee slices.
Remove any client-side refetching, polling, or router.refresh() calls.

Businesses list (src/app/(authenticated)/businesses/):

Read from store.businesses.
Remove composite query refetching on navigation.

Business details (src/app/(authenticated)/businesses/[id]/):

Read the specific business from store.businesses by ID, including its employees, production slots, manufacturing lines, and shelves.
Remove the 30-second router.refresh().
Convert all mutation flows (hire, assign, upgrade, retool, etc.) to use optimistic updates. Each mutation should: update the store immediately, call the API route, and roll back on failure.
Stop chaining multiple API calls with a full page refresh after — the Realtime subscription will update related data automatically.

Production/Manufacturing (src/app/(authenticated)/production/):

Read from store.production.
Remove the 15-second polling of /api/production/manufacturing entirely.
Manufacturing progress updates will come in via the Realtime subscription when cron ticks update the manufacturing_jobs table.

Banking (src/app/(authenticated)/banking/):

Read from store.banking.
Convert transfers, loan payments, and loan applications to optimistic updates.

Inventory (src/app/(authenticated)/inventory/):

Read from store.inventory.
Convert transfer actions to optimistic updates.

Market (src/app/(authenticated)/market/):

Read from store.market.
Convert create listing, buy, and cancel to optimistic updates.

Contracts (src/app/(authenticated)/contracts/):

Read from store.contracts.
Convert accept, cancel, and fulfill to optimistic updates.

Employees (src/app/(authenticated)/employees/):

Read from store.employees.
Convert hire, assign, unassign, fire, and reactivate to optimistic updates.

Travel (src/app/(authenticated)/travel/):

Read from store.travel.
Remove the 5-second router.refresh() entirely.
Implement a local countdown timer that calculates remaining time from the travel ETA.
When the Realtime subscription receives a travel completion event, update the store and the UI transitions to the arrived state.
Keep the start-travel and cancel-travel server actions but add optimistic store updates.

Chat (Topbar):

Read from store.chat.
Remove the 5-second poll of /api/chat entirely.
New messages arrive via the Realtime subscription.
Sending a message should optimistically append it to the store, call the API, and roll back on failure.

Player Profile (src/app/(authenticated)/players/[id]/):

Remove the 30-second page refresh.
If viewing own profile, read from store.player.
If viewing another player's profile, this can remain a server fetch with ISR or a client query with a long stale time (60s+), since you don't have Realtime subscriptions for other players' data.

App Shell / Topbar:

Read unread counts, notifications, and presence from store.appShell.
Remove the duplicate /api/realtime-auth fetch — the Realtime provider handles this now.
Keep the heartbeat POST to /api/app-shell for server-side presence tracking, but reduce its frequency from the current interval to every 60 seconds.
Read the app-shell GET data (player info, notifications) from the store instead of polling.


Step 7: Clean Up the Authenticated Shell Data Layer
The existing AuthenticatedShellDataLayer component currently manages Supabase Realtime subscriptions and invalidates React Query caches on broad table changes. This is being replaced by the new Realtime provider and store.

Remove or gut AuthenticatedShellDataLayer's Realtime subscription logic (it moves to the Realtime provider).
Remove its broad cache invalidation logic (the store is now the source of truth).
If it still serves a purpose for layout rendering, keep the component but strip it of data-fetching and subscription responsibilities.


Step 8: Clean Up React Query Usage
After the migration:

Remove React Query polling configurations (refetchInterval) from all authenticated page queries.
React Query can still be used for the initial server-side data fetch and for non-player-scoped data (public stats, city lists, etc.), but it should not be the primary data source for authenticated game state after hydration.
Remove any router.refresh() calls that were being used for data freshness. All of them. Search the entire codebase for router.refresh() in authenticated pages and remove or replace each one.


What NOT to Change

Do not modify any API route logic or server-side validation. The API routes stay as they are — they are still the mutation endpoints.
Do not modify any Supabase Edge Functions or cron jobs. The ticks continue running and writing to the database as before. The Realtime subscriptions will pick up their changes automatically.
Do not modify any database schema, RLS policies, or migrations.
Do not remove any API routes even if they are no longer polled — they may still be needed for mutations or future use.
Keep the existing server-component-based initial render for every page. The SSR path must continue to work for first loads and for users with JavaScript disabled or slow connections.


Testing Checklist
After implementing, verify the following for each page:

First load (hard refresh) still works and shows correct data via SSR.
Client navigation to the page shows data immediately from the store without a loading flash.
When another player or a cron tick changes relevant data, the page updates within 1-2 seconds without any manual refresh.
Mutations (buy, sell, hire, transfer, etc.) update the UI immediately and do not trigger a full page refresh.
If you kill the WebSocket connection (e.g., toggle airplane mode briefly), the fallback poll kicks in within 5 seconds and data stays reasonably current.
No router.refresh() calls remain in any authenticated page or component.
No polling intervals under 60 seconds remain anywhere in the codebase.
The Vercel function invocation count for a single active tab drops to near-zero during idle browsing (no actions being taken).

