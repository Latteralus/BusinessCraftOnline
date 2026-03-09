"use client";

import type { BusinessWithBalance } from "@/domains/businesses";
import type { ManufacturingStatusView } from "@/domains/production";
import { useAutoRefresh } from "@/hooks/useAutoRefresh";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

type BusinessesResponse = {
  businesses: BusinessWithBalance[];
};

type ManufacturingResponse = {
  status: ManufacturingStatusView;
  error?: string;
};

export default function ProductionPage() {
  const [businesses, setBusinesses] = useState<BusinessWithBalance[]>([]);
  const [selectedBusinessId, setSelectedBusinessId] = useState("");
  const [manufacturing, setManufacturing] = useState<ManufacturingStatusView | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const manufacturingBusinesses = useMemo(
    () =>
      businesses.filter((business) =>
        [
          "sawmill",
          "metalworking_factory",
          "food_processing_plant",
          "winery_distillery",
          "carpentry_workshop",
        ].includes(business.type)
      ),
    [businesses]
  );

  async function loadBusinesses() {
    const response = await fetch("/api/businesses", { cache: "no-store" });
    const payload = (await response.json()) as BusinessesResponse & { error?: string };

    if (!response.ok) {
      throw new Error(payload.error ?? "Failed to load businesses.");
    }

    setBusinesses(payload.businesses ?? []);
    if (!selectedBusinessId && payload.businesses?.length) {
      const first = payload.businesses.find((business) =>
        [
          "sawmill",
          "metalworking_factory",
          "food_processing_plant",
          "winery_distillery",
          "carpentry_workshop",
        ].includes(business.type)
      );

      if (first) setSelectedBusinessId(first.id);
    }
  }

  async function loadManufacturingStatus(businessId: string) {
    if (!businessId) {
      setManufacturing(null);
      return;
    }

    const response = await fetch(`/api/production/manufacturing?businessId=${businessId}`, {
      cache: "no-store",
    });
    const payload = (await response.json()) as ManufacturingResponse;

    if (!response.ok) {
      throw new Error(payload.error ?? "Failed to load manufacturing status.");
    }

    setManufacturing(payload.status);
  }

  useEffect(() => {
    async function init() {
      setLoading(true);
      setError(null);

      try {
        await loadBusinesses();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to initialize production page.");
      } finally {
        setLoading(false);
      }
    }

    void init();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!selectedBusinessId) {
      setManufacturing(null);
      return;
    }

    setError(null);
    void loadManufacturingStatus(selectedBusinessId).catch((err) =>
      setError(err instanceof Error ? err.message : "Failed to load manufacturing status.")
    );
  }, [selectedBusinessId]);

  useAutoRefresh(
    async () => {
      if (!selectedBusinessId) {
        return;
      }
      try {
        await Promise.all([loadBusinesses(), loadManufacturingStatus(selectedBusinessId)]);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to refresh production status.");
      }
    },
    { intervalMs: 8000, enabled: !loading && Boolean(selectedBusinessId) }
  );

  async function setRecipe(recipeKey: string) {
    if (!selectedBusinessId || !recipeKey || busy) return;
    setBusy(true);
    setError(null);

    const response = await fetch("/api/production/manufacturing", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ businessId: selectedBusinessId, recipeKey }),
    });

    const payload = (await response.json()) as ManufacturingResponse;
    setBusy(false);

    if (!response.ok) {
      setError(payload.error ?? "Failed to set recipe.");
      return;
    }

    setManufacturing(payload.status);
  }

  async function setRunning(action: "start" | "stop") {
    if (!selectedBusinessId || busy) return;
    setBusy(true);
    setError(null);

    const response = await fetch("/api/production/manufacturing", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ businessId: selectedBusinessId, action }),
    });

    const payload = (await response.json()) as ManufacturingResponse;
    setBusy(false);

    if (!response.ok) {
      setError(payload.error ?? `Failed to ${action} manufacturing.`);
      return;
    }

    setManufacturing(payload.status);
  }

  return (
    <div className="anim">
      <header className="lc-page-header">
        <div>
          <h1>Production</h1>
          <p>
            Manufacturing controls: choose recipes, start or stop jobs, and monitor status.
          </p>
        </div>
        <div style={{ alignSelf: "center" }}>
          <Link href="/dashboard">Back to Dashboard</Link>
        </div>
      </header>

      {loading ? <p>Loading production data...</p> : null}
      {error ? <p style={{ color: "#f87171" }}>{error}</p> : null}

      {!loading ? (
        <section>
          <h2 style={{ marginTop: 0 }}>Manufacturing Job</h2>

          <label>
            Business
            <select
              value={selectedBusinessId}
              onChange={(event) => setSelectedBusinessId(event.target.value)}
              title="Business"
            >
              <option value="">Select manufacturing business</option>
              {manufacturingBusinesses.map((business) => (
                <option key={business.id} value={business.id}>
                  {business.name} ({business.type})
                </option>
              ))}
            </select>
          </label>

          {manufacturing ? (
            <div style={{ marginTop: 12, display: "grid", gap: 8 }}>
              <p style={{ margin: 0 }}>
                <strong>Status:</strong> {manufacturing.job.status}
              </p>
              <p style={{ margin: 0 }}>
                <strong>Worker assigned:</strong> {manufacturing.job.worker_assigned ? "Yes" : "No"}
              </p>
              <p style={{ margin: 0 }}>
                <strong>Last Tick:</strong> {manufacturing.job.last_tick_at ?? "Never"}
              </p>

              <label>
                Active Recipe
                <select
                  value={manufacturing.job.active_recipe_key ?? ""}
                  onChange={(event) => void setRecipe(event.target.value)}
                  title="Recipe"
                  disabled={busy}
                >
                  <option value="">Select recipe</option>
                  {manufacturing.job.recipes.map((recipe) => (
                    <option key={recipe.key} value={recipe.key}>
                      {recipe.displayName}
                    </option>
                  ))}
                </select>
              </label>

              <div style={{ display: "flex", gap: 8 }}>
                <button
                  onClick={() => void setRunning("start")}
                  disabled={busy || !manufacturing.job.active_recipe_key || !manufacturing.job.worker_assigned}
                >
                  Start
                </button>
                <button onClick={() => void setRunning("stop")} disabled={busy}>
                  Stop
                </button>
              </div>
            </div>
          ) : (
            <p style={{ marginTop: 12, color: "#94a3b8" }}>
              Select a manufacturing business to manage its job.
            </p>
          )}
        </section>
      ) : null}
    </div>
  );
}
