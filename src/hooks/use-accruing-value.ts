"use client";

import { useEffect, useRef, useState } from "react";

type Options = {
  factor?: number;       // conservative multiplier on observed rate, default 0.85
  maxDriftMs?: number;   // cap on how far ahead we project, default 90s
};

/**
 * Extrapolates a numeric value forward between server syncs using the observed rate
 * of change between the last two syncs. Always aims conservatively (factor < 1) and
 * snaps back to the ground-truth value on each new sync.
 *
 * Works best for slowly-increasing values (balances, treasury totals) where
 * the direction is predictable but exact timing is not.
 */
export function useAccruingValue(
  value: number,
  syncedAt: number,
  options?: Options
): number {
  const factor = options?.factor ?? 0.85;
  const maxDriftMs = options?.maxDriftMs ?? 90_000;

  // Keep refs so the interval callback always reads the latest values.
  const valueRef = useRef(value);
  const syncedAtRef = useRef(syncedAt);
  valueRef.current = value;
  syncedAtRef.current = syncedAt;

  // Rolling rate estimate ($ per ms). Updated when syncedAt changes.
  const rateRef = useRef(0);
  const prevRef = useRef<{ value: number; syncedAt: number } | null>(null);

  // Compute rate during render — ref mutation is safe here (idempotent, no state change).
  const prev = prevRef.current;
  if (prev !== null && prev.syncedAt !== syncedAt) {
    const elapsed = syncedAt - prev.syncedAt;
    const delta = value - prev.value;
    if (elapsed > 0 && delta > 0) {
      const observed = delta / elapsed;
      // Exponentially weighted moving average biased toward recent history.
      rateRef.current = rateRef.current === 0
        ? observed
        : 0.6 * rateRef.current + 0.4 * observed;
    } else if (delta <= 0) {
      // Value dropped or held flat — stop extrapolating upward.
      rateRef.current = 0;
    }
  }
  prevRef.current = { value, syncedAt };

  const [displayed, setDisplayed] = useState(value);

  useEffect(() => {
    // Immediately snap to the confirmed server value.
    setDisplayed(value);

    if (rateRef.current <= 0) return;

    const id = window.setInterval(() => {
      const elapsed = Math.min(Date.now() - syncedAtRef.current, maxDriftMs);
      setDisplayed(valueRef.current + elapsed * rateRef.current * factor);
    }, 1000);

    return () => window.clearInterval(id);
  }, [value, syncedAt, factor, maxDriftMs]);

  return displayed;
}
