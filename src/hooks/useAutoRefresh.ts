"use client";

import { useEffect, useRef } from "react";

type AutoRefreshOptions = {
  enabled?: boolean;
  intervalMs?: number;
};

export function useAutoRefresh(
  refresh: () => Promise<void> | void,
  options: AutoRefreshOptions = {}
) {
  const { enabled = true, intervalMs = 10000 } = options;
  const inFlightRef = useRef(false);
  const refreshRef = useRef(refresh);

  refreshRef.current = refresh;

  useEffect(() => {
    if (!enabled) {
      return;
    }

    const runRefresh = async () => {
      if (inFlightRef.current || document.hidden) {
        return;
      }

      inFlightRef.current = true;
      try {
        await refreshRef.current();
      } finally {
        inFlightRef.current = false;
      }
    };

    const timer = window.setInterval(() => {
      void runRefresh();
    }, intervalMs);

    const onVisibilityChange = () => {
      if (!document.hidden) {
        void runRefresh();
      }
    };

    const onFocus = () => {
      void runRefresh();
    };

    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("focus", onFocus);

    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("focus", onFocus);
    };
  }, [enabled, intervalMs]);
}
