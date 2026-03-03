"use client";

import type { City, TravelLog, TravelQuote } from "@/domains/cities-travel";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

type TravelResponse = {
  currentCity: City | null;
  activeTravel: TravelLog | null;
  canPurchaseBusiness: boolean;
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

export default function TravelPage() {
  const [cities, setCities] = useState<City[]>([]);
  const [travelState, setTravelState] = useState<TravelResponse | null>(null);
  const [selectedCityId, setSelectedCityId] = useState<string>("");
  const [quote, setQuote] = useState<TravelQuote | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [nowMs, setNowMs] = useState(Date.now());
  const [error, setError] = useState<string | null>(null);

  async function loadData() {
    setLoading(true);
    setError(null);

    const [citiesResponse, travelResponse] = await Promise.all([
      fetch("/api/cities"),
      fetch("/api/travel", { cache: "no-store" }),
    ]);

    const citiesData = await citiesResponse.json();
    const travelData = await travelResponse.json();

    if (!citiesResponse.ok) {
      setError(citiesData.error ?? "Failed to load cities.");
      setLoading(false);
      return;
    }

    if (!travelResponse.ok) {
      setError(travelData.error ?? "Failed to load travel status.");
      setLoading(false);
      return;
    }

    setCities(citiesData.cities ?? []);
    setTravelState(travelData as TravelResponse);
    setLoading(false);
  }

  useEffect(() => {
    void loadData();
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

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
    if (!destinationCityId || destinationCityId === travelState?.currentCity?.id) {
      setQuote(null);
      return;
    }

    const response = await fetch("/api/travel/quote", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ toCityId: destinationCityId }),
    });

    const data = await response.json();
    if (!response.ok) {
      setQuote(null);
      setError(data.error ?? "Could not calculate travel quote.");
      return;
    }

    setQuote(data.quote ?? null);
  }

  async function startTravel() {
    if (!selectedCityId || submitting) return;
    setSubmitting(true);
    setError(null);

    const response = await fetch("/api/travel", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ toCityId: selectedCityId }),
    });

    const data = await response.json();
    setSubmitting(false);

    if (!response.ok) {
      setError(data.error ?? "Travel request failed.");
      return;
    }

    setSelectedCityId("");
    setQuote(null);
    await loadData();
  }

  async function cancelTravel() {
    if (submitting) return;
    setSubmitting(true);
    setError(null);

    const response = await fetch("/api/travel", {
      method: "DELETE",
    });

    const data = await response.json();
    setSubmitting(false);

    if (!response.ok) {
      setError(data.error ?? "Could not cancel travel.");
      return;
    }

    await loadData();
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

      {loading ? <p>Loading travel data...</p> : null}
      {error ? <p style={{ color: "#f87171" }}>{error}</p> : null}

      {!loading && travelState ? (
        <>
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
        </>
      ) : null}
    </div>
  );
}
