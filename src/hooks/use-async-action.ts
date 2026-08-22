"use client";

import { useCallback, useRef, useState } from "react";

type UseAsyncActionOptions = {
  fallbackError?: string;
  onError?: (message: string) => void;
  beforeRun?: () => void;
};

// Collapses the guard/reset/try/catch/finally shape repeated at mutation
// handlers across the authenticated *Client.tsx pages: guard against a
// second submit while one is already in flight, run the action, and report
// any thrown error's message (or a fallback) through onError. The caller
// still reports success itself (e.g. setSuccess(...) inside the action) --
// success messages vary per-action, unlike the busy/error shape, which
// doesn't.
export function useAsyncAction(action: () => Promise<void>, options?: UseAsyncActionOptions) {
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);

  const run = useCallback(async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    options?.beforeRun?.();
    try {
      await action();
    } catch (err) {
      const message = err instanceof Error ? err.message : (options?.fallbackError ?? "Something went wrong.");
      options?.onError?.(message);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }, [action, options]);

  return { busy, run } as const;
}
