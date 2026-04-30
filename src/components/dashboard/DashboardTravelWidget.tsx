"use client";

import { useNowMs } from "@/hooks/use-now-ms";
import { useTravelSlice } from "@/stores/game-store";
import type { TravelLog } from "@/domains/cities-travel";

type Props = {
  initialActiveTravel: TravelLog | null;
  initialDestinationCityName: string | null;
  initialCurrentCityName: string | null;
};

function formatCountdown(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}h ${String(minutes).padStart(2, "0")}m`;
  if (minutes > 0) return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
  return `${seconds}s`;
}

export function DashboardTravelWidget({ initialActiveTravel, initialDestinationCityName, initialCurrentCityName }: Props) {
  const storeTravel = useTravelSlice();
  const nowMs = useNowMs();

  // Prefer live store data (updated by realtime events); fall back to server props.
  const activeTravel = storeTravel?.activeTravel !== undefined
    ? storeTravel.activeTravel
    : initialActiveTravel;
  const currentCityName = storeTravel?.currentCity?.name ?? initialCurrentCityName ?? "Unknown";

  const arrivesMs = activeTravel ? new Date(activeTravel.arrives_at).getTime() : null;
  const remainingMs = arrivesMs !== null && nowMs !== null
    ? Math.max(0, arrivesMs - nowMs)
    : null;
  const hasArrived = remainingMs === 0;

  return (
    <>
      <div className="travel-location">
        <div className="travel-city">📍 {currentCityName}</div>
      </div>
      <div style={{ fontSize: "0.68rem", color: "var(--text-muted)", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.5px" }}>Travel Status:</div>
      <div className="travel-cities-row">
        <div className="city-chip current">
          {!activeTravel ? (
            "Stationary"
          ) : hasArrived ? (
            "Arrived at destination"
          ) : remainingMs === null ? (
            // nowMs not yet available (before hydration) — use server-computed rough value
            `Traveling to ${initialDestinationCityName ?? "destination"}`
          ) : (
            `Traveling to ${initialDestinationCityName ?? "destination"} (${formatCountdown(remainingMs)} left)`
          )}
        </div>
      </div>
    </>
  );
}
