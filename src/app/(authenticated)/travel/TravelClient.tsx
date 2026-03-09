"use client";

import type { City, TravelQuote, TravelState } from "@/domains/cities-travel";
import { useAutoRefresh } from "@/hooks/useAutoRefresh";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { cancelTravelAction, getTravelQuoteAction, startTravelAction } from "./actions";

type Props = {
  cities: City[];
  travelState: TravelState;
};

function formatDuration(ms: number) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}h ${String(minutes).padStart(2, "0")}m ${String(seconds).padStart(2, "0")}s`;
  }

  return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
}

function getTravelCountdown(arrivesAt: string, nowMs: number) {
  const remaining = new Date(arrivesAt).getTime() - nowMs;
  return formatDuration(remaining);
}

export default function TravelClient({ cities, travelState }: Props) {
  const router = useRouter();
  const [selectedCityId, setSelectedCityId] = useState<string>("");
  const [quote, setQuote] = useState<TravelQuote | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [nowMs, setNowMs] = useState(Date.now());
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useAutoRefresh(
    () => {
      router.refresh();
    },
    { intervalMs: 5000, enabled: Boolean(travelState.activeTravel) }
  );

  const selectedCity = useMemo(
    () => cities.find((city) => city.id === selectedCityId) ?? null,
    [cities, selectedCityId]
  );

  const cityById = useMemo(
    () => new Map(cities.map((city) => [city.id, city])),
    [cities]
  );

  async function getQuote(destinationCityId: string) {
    setError(null);
    if (!destinationCityId || destinationCityId === travelState.currentCity?.id) {
      setQuote(null);
      return;
    }

    const result = await getTravelQuoteAction(destinationCityId);
    if (!result.ok || !result.data) {
      setQuote(null);
      setError(result.error ?? "Could not calculate travel quote.");
      return;
    }

    setQuote(result.data);
  }

  async function startTravel() {
    if (!selectedCityId || submitting) return;
    setSubmitting(true);
    setError(null);

    const result = await startTravelAction(selectedCityId);
    setSubmitting(false);

    if (!result.ok) {
      setError(result.error ?? "Travel request failed.");
      return;
    }

    setSelectedCityId("");
    setQuote(null);
    router.refresh();
  }

  async function cancelTravel() {
    if (submitting) return;
    setSubmitting(true);
    setError(null);

    const result = await cancelTravelAction();
    setSubmitting(false);

    if (!result.ok) {
      setError(result.error ?? "Could not cancel travel.");
      return;
    }

    router.refresh();
  }

  return (
    <div className="anim">
      <header className="lc-page-header">
        <div>
          <h1>Travel</h1>
          <p>
            Move between cities with route-based travel time and cost.
          </p>
        </div>
        <div style={{ alignSelf: "center" }}>
          <Link href="/dashboard">Back to Dashboard</Link>
        </div>
      </header>

      {error ? <p style={{ color: "#f87171" }}>{error}</p> : null}

      <section>
        <h2 style={{ marginTop: 0 }}>Current Location</h2>
        <p>
          <strong>City:</strong> {travelState.currentCity?.name ?? "Unknown"}
        </p>
        <p>
          <strong>Business Purchase Status:</strong>{" "}
          {travelState.canPurchaseBusiness ? "Allowed" : "Blocked while traveling"}
        </p>
      </section>

      <section>
        <h2 style={{ marginTop: 0 }}>Travel Status</h2>
        {travelState.activeTravel ? (
          <>
            <p>
              <strong>Route:</strong>{" "}
              {cityById.get(travelState.activeTravel.from_city_id)?.name ??
                travelState.activeTravel.from_city_id}{" "}
              →{" "}
              {cityById.get(travelState.activeTravel.to_city_id)?.name ??
                travelState.activeTravel.to_city_id}
            </p>
            <p>
              <strong>Arrives In:</strong>{" "}
              {getTravelCountdown(travelState.activeTravel.arrives_at, nowMs)}
            </p>
            <p>
              <strong>Travel Cost:</strong> ${Number(travelState.activeTravel.cost).toFixed(2)}
            </p>
            <button onClick={cancelTravel} disabled={submitting}>
              {submitting ? "Cancelling..." : "Cancel Travel"}
            </button>
          </>
        ) : (
          <p>No active travel.</p>
        )}
      </section>

      <section>
        <h2 style={{ marginTop: 0 }}>Start Travel</h2>
        <div style={{ display: "grid", gap: 10, maxWidth: 420 }}>
          <label htmlFor="destinationCity">Destination city</label>
          <select
            id="destinationCity"
            title="Destination city"
            value={selectedCityId}
            onChange={(event) => {
              const destinationId = event.target.value;
              setSelectedCityId(destinationId);
              void getQuote(destinationId);
            }}
            disabled={Boolean(travelState.activeTravel) || submitting}
          >
            <option value="">Select destination city</option>
            {cities.map((city) => (
              <option
                key={city.id}
                value={city.id}
                disabled={city.id === travelState.currentCity?.id}
              >
                {city.name}, {city.state}
              </option>
            ))}
          </select>

          {selectedCity ? (
            <p style={{ margin: 0 }}>
              <strong>Destination:</strong> {selectedCity.name}, {selectedCity.state}
            </p>
          ) : null}

          {quote ? (
            <div style={{ fontSize: 14, color: "#cbd5e1" }}>
              <p style={{ margin: "4px 0" }}>
                <strong>Tier:</strong> {quote.tier}
              </p>
              <p style={{ margin: "4px 0" }}>
                <strong>Duration:</strong> {quote.minutes} minutes
              </p>
              <p style={{ margin: "4px 0" }}>
                <strong>Cost:</strong> ${quote.cost.toFixed(2)}
              </p>
            </div>
          ) : null}

          <button
            onClick={startTravel}
            disabled={!selectedCityId || Boolean(travelState.activeTravel) || submitting}
          >
            {submitting ? "Starting Travel..." : "Start Travel"}
          </button>
        </div>
      </section>
    </div>
  );
}
