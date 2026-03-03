# Data Loading Strategy Migration Plan

## Current State
The application is currently relying on Client Components (`"use client"`) that fetch data inside `useEffect` blocks. This results in the "waterfall effect":
1. Next.js loads the page shell.
2. The client hydrates and runs `useEffect`.
3. The component sets `loading = true` and fires an API request.
4. The user stares at a loading spinner/text until the API returns data.

Also, `layout.tsx` fetches data using Server Components but blocks the entire render until `Promise.all` completes (fetching user, character, storefront settings, and player count). This means navigating *to* the app or between major layouts feels slow because nothing renders until the server is done.

## Proposed Strategy: React Server Components (RSC) & Streaming

We can significantly improve the perceived performance and Time To First Byte (TTFB) by migrating to **React Server Components** with **Streaming** and **Suspense**.

### 1. Shift Data Fetching to Server Components
Instead of fetching in `useEffect`, we should fetch data directly in the Server Component (`page.tsx`). 
- **Benefits:** Eliminates client-side waterfalls, reduces client bundle size, and allows direct database access (bypassing the need for `/api` routes entirely if we want).
- **Execution:** Pages like `ProductionPage` and `TravelPage` will become async Server Components. The interactive parts (buttons, forms, selects) will be extracted into smaller Client Components.

### 2. Implement React Suspense & Streaming (`loading.tsx`)
Currently, `layout.tsx` blocks rendering. By adding a `loading.tsx` file at the route level, Next.js will instantly render the layout and a fallback UI while the page content is fetching in the background.
- **Benefits:** Instant page transitions. The user sees the UI change immediately upon clicking a link, and the specific page content streams in when ready.
- **Execution:** Add `loading.tsx` files to `src/app/(authenticated)/` and its subdirectories. Wrap slow data fetches in `<Suspense fallback={<Skeleton />}>`.

### 3. Server Actions for Mutations
Instead of using `fetch('/api/...')` in event handlers, we can migrate to Next.js Server Actions.
- **Benefits:** Allows form submissions and mutations without creating separate API endpoints. Integrates cleanly with `useTransition` for optimistic UI updates.
- **Execution:** Replace client-side API calls (like `startTravel` or `setRecipe`) with Server Actions.

### 4. SWR or React Query (Optional, for polling)
For pages that need real-time or frequent updates (like countdowns or rapidly changing status), if we still want client-side fetching, we should use a library like SWR or React Query.
- **Benefits:** Built-in caching, background refetching, and optimistic updates. Pages load from cache instantly.

## Action Plan (Todos)

1. [ ] Create a generic `loading.tsx` for the `(authenticated)` route group to provide instant visual feedback on navigation.
2. [ ] Refactor `src/app/(authenticated)/layout.tsx` to not block rendering unnecessarily (wrap slower fetches in Suspense if possible, or leave as is if the data is required for the Topbar).
3. [ ] Refactor a single page (e.g., `Travel` or `Production`) to be a Server Component.
4. [ ] Extract interactive elements of that page into smaller Client Components.
5. [ ] Replace client-side API calls for that page with Server Actions.
6. [ ] Review the performance improvement and apply the pattern to the rest of the application.
