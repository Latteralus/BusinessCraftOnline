"use client";

import { useEffect, useState } from "react";

export function useNowMs(intervalMs = 1000): number | null {
  const [nowMs, setNowMs] = useState<number | null>(null);

  useEffect(() => {
    setNowMs(Date.now());
    const id = window.setInterval(() => setNowMs(Date.now()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);

  return nowMs;
}
