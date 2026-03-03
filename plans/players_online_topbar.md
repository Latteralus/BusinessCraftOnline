# Players Online Topbar Plan

## Context
The user wants to add a "Players Online: [count]" indicator to the topbar, right next to the existing "US-East · Online" indicator. The new indicator should match the styling (padding, flashing green dot) of the existing one.

## Proposed Steps
1. **Fetch Player Count Function:**
   - Add a `getPlayerCount` function to `src/domains/auth-character/service.ts` to perform a `SELECT count(*)` on the `players` table.
   - Export this new function from `src/domains/auth-character/index.ts`.

2. **Retrieve Data in Layout:**
   - Update the async server component `src/app/(authenticated)/layout.tsx` to call `getPlayerCount(supabase)` in parallel with the other data fetching.
   - Pass the returned count as a new `playerCount` prop to the `<Topbar>` component.

3. **Update Topbar Component:**
   - Update `src/components/layout/Topbar.tsx` to add `playerCount: number` to the `TopbarProps` interface.
   - Add a second `<div className="server-badge">` below the existing one.
   - Inside the new badge, include the flashing dot `<div className="server-dot"></div>` and the text `"Players Online: {playerCount}"`.

## Rationale
- Leveraging SSR fetching keeps the component clean without needing extra API routes or client-side hooks.
- Since the top bar relies on `topbar-left` class which has `display: flex; gap: 20px;`, simply adding another `<div className="server-badge">` next to the existing one will perfectly align it with the exact requested padding.
