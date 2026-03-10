"use client";

import type { City, TravelQuote, TravelState } from "@/domains/cities-travel";
import { TooltipLabel } from "@/components/ui/tooltip";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { cancelTravelAction, getTravelQuoteAction, startTravelAction } from "./actions";
import { useGameStore, useTravelSlice } from "@/stores/game-store";

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

export default function TravelClient({ cities, travelState: initialTravelState }: Props) {
  const storeTravelState = useTravelSlice() ?? initialTravelState;
  const setTravel = useGameStore((state) => state.setTravel);
  const [selectedCityId, setSelectedCityId] = useState<string>("");
  const [quote, setQuote] = useState<TravelQuote | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [nowMs, setNowMs] = useState(Date.now());
  const [error, setError] = useState<string | null>(null);
  const arrivalHandledRef = useRef(false);
  const activeTravelEta = storeTravelState.activeTravel?.arrives_at ?? null;

  useEffect(() => {
    setNowMs(Date.now());
    arrivalHandledRef.current = false;
  }, [activeTravelEta]);

  useEffect(() => {
    if (!storeTravelState.activeTravel) {
      return;
    }

    const timer = window.setInterval(() => {
      setNowMs(Date.now());
    }, 1000);

    return () => window.clearInterval(timer);
  }, [storeTravelState.activeTravel]);

  useEffect(() => {
    if (!activeTravelEta || arrivalHandledRef.current) {
      return;
    }

    if (new Date(activeTravelEta).getTime() - nowMs > 1000) {
      return;
    }

    arrivalHandledRef.current = true;
    setTravel({
      ...storeTravelState,
      activeTravel: null,
      canPurchaseBusiness: true,
    });
  }, [activeTravelEta, nowMs, setTravel, storeTravelState]);

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
    if (!destinationCityId || destinationCityId === storeTravelState.currentCity?.id) {
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
    if (!selectedCityId || submitting || !quote) return;
    setSubmitting(true);
    setError(null);

    const destination = cities.find((city) => city.id === selectedCityId) ?? null;
    const optimisticTravel = destination && storeTravelState.currentCity ? {
      id: `optimistic-travel-${Date.now()}`,
      player_id: "me",
      from_city_id: storeTravelState.currentCity.id,
      to_city_id: destination.id,
      departs_at: new Date().toISOString(),
      arrives_at: new Date(Date.now() + quote.minutes * 60_000).toISOString(),
      cost: quote.cost,
      status: "traveling" as const,
      created_at: new Date().toISOString(),
    } : null;

    if (optimisticTravel) {
      setTravel({
        currentCity: storeTravelState.currentCity,
        activeTravel: optimisticTravel,
        canPurchaseBusiness: false,
      });
    }

    const result = await startTravelAction(selectedCityId);
    setSubmitting(false);

    if (!result.ok) {
      setTravel(initialTravelState);
      setError(result.error ?? "Travel request failed.");
      return;
    }

    setSelectedCityId("");
    setQuote(null);
  }

  async function cancelTravel() {
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    const previousState = storeTravelState;
    setTravel({
      ...storeTravelState,
      activeTravel: null,
      canPurchaseBusiness: true,
    });

    const result = await cancelTravelAction();
    setSubmitting(false);

    if (!result.ok) {
      setTravel(previousState);
      setError(result.error ?? "Could not cancel travel.");
    }
  }

  return (
    <div className="anim">
      <header className="lc-page-header">
        <div>
          <h1>Travel</h1>
          <p>Hit the road.</p>
        </div>
        <div style={{ alignSelf: "center" }}>
          <Link href="/dashboard">Back to Dashboard</Link>
        </div>
      </header>

      {error ? <p style={{ color: "#f87171" }}>{error}</p> : null}

      <section>
        <h2 style={{ marginTop: 0 }}>Current Location</h2>
        <p>
          <strong>City:</strong> {storeTravelState.currentCity?.name ?? "Unknown"}
        </p>
        <p>
          <strong><TooltipLabel label="Business Purchase Status" content="You cannot buy a new business while your character is actively traveling between cities." /></strong>{" "}
          {storeTravelState.canPurchaseBusiness ? "Allowed" : "Blocked while traveling"}
        </p>
      </section>

      <section>
        <h2 style={{ marginTop: 0 }}>Travel Status</h2>
        {storeTravelState.activeTravel ? (
          <>
            <p>
              <strong>Route:</strong>{" "}
              {cityById.get(storeTravelState.activeTravel.from_city_id)?.name ??
                storeTravelState.activeTravel.from_city_id}{" "}
              →{" "}
              {cityById.get(storeTravelState.activeTravel.to_city_id)?.name ??
                storeTravelState.activeTravel.to_city_id}
            </p>
            <p>
              <strong>Arrives In:</strong>{" "}
              {getTravelCountdown(storeTravelState.activeTravel.arrives_at, nowMs)}
            </p>
            <p>
              <strong>Travel Cost:</strong> ${Number(storeTravelState.activeTravel.cost).toFixed(2)}
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
          <label htmlFor="destinationCity"><TooltipLabel label="Destination city" content="Choose where you want to travel next. The quote updates with time and cost." /></label>
          <select
            id="destinationCity"
            title="Destination city"
            value={selectedCityId}
            onChange={(event) => {
              const destinationId = event.target.value;
              setSelectedCityId(destinationId);
              void getQuote(destinationId);
            }}
            disabled={Boolean(storeTravelState.activeTravel) || submitting}
          >
            <option value="">Select destination city</option>
            {cities.map((city) => (
              <option
                key={city.id}
                value={city.id}
                disabled={city.id === storeTravelState.currentCity?.id}
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
                <strong><TooltipLabel label="Tier" content="Distance band used to determine travel time and cost between the two cities." /></strong> {quote.tier}
              </p>
              <p style={{ margin: "4px 0" }}>
                <strong><TooltipLabel label="Duration" content="How long the trip will take in real time once travel starts." /></strong> {quote.minutes} minutes
              </p>
              <p style={{ margin: "4px 0" }}>
                <strong><TooltipLabel label="Cost" content="Travel fee charged when the trip begins." /></strong> ${quote.cost.toFixed(2)}
              </p>
            </div>
          ) : null}

          <button
            onClick={startTravel}
            disabled={!selectedCityId || Boolean(storeTravelState.activeTravel) || submitting}
          >
            {submitting ? "Starting Travel..." : "Start Travel"}
          </button>
        </div>
      </section>
    </div>
  );
}
