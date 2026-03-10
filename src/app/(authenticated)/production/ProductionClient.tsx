"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { ManufacturingStatusView } from "@/domains/production";
import { apiGet } from "@/lib/client/api";
import { fetchProductionPageData, queryKeys, type ProductionPageData } from "@/lib/client/queries";
import Link from "next/link";
import { useMemo, useState } from "react";

type Props = {
  initialData: ProductionPageData;
};

type ManufacturingResponse = { status: ManufacturingStatusView; error?: string };

export default function ProductionClient({ initialData }: Props) {
  const queryClient = useQueryClient();
  const [selectedBusinessId, setSelectedBusinessId] = useState(initialData.selectedBusinessId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const productionPageQuery = useQuery({
    queryKey: queryKeys.productionPage,
    queryFn: fetchProductionPageData,
    initialData,
  });
  const businesses = productionPageQuery.data.businesses;
  const manufacturingStatusQuery = useQuery({
    queryKey: queryKeys.productionStatus(selectedBusinessId || "none"),
    queryFn: async () => {
      const payload = await apiGet<ManufacturingResponse>(`/api/production/manufacturing?businessId=${selectedBusinessId}`, {
        fallbackError: "Failed to load manufacturing status.",
      });
      return payload.status;
    },
    enabled: Boolean(selectedBusinessId),
    initialData: selectedBusinessId === initialData.selectedBusinessId ? initialData.manufacturing ?? undefined : undefined,
    refetchInterval: selectedBusinessId ? 15_000 : false,
  });
  const manufacturing = selectedBusinessId ? manufacturingStatusQuery.data ?? null : null;

  const manufacturingBusinesses = useMemo(
    () =>
      businesses.filter((business) =>
        ["sawmill", "metalworking_factory", "food_processing_plant", "winery_distillery", "carpentry_workshop"].includes(business.type)
      ),
    [businesses]
  );

  async function setRecipe(lineId: string, recipeKey: string) {
    if (!lineId || !recipeKey || busy) return;
    setBusy(true);
    setError(null);
    const response = await fetch("/api/production/manufacturing", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lineId, recipeKey }),
    });
    const payload = (await response.json()) as ManufacturingResponse;
    setBusy(false);
    if (!response.ok) {
      setError(payload.error ?? "Failed to set recipe.");
      return;
    }
    queryClient.setQueryData(queryKeys.productionStatus(selectedBusinessId), payload.status);
    void queryClient.invalidateQueries({ queryKey: queryKeys.productionPage });
  }

  async function setRunning(lineId: string, action: "start" | "stop") {
    if (!lineId || busy) return;
    setBusy(true);
    setError(null);
    const response = await fetch("/api/production/manufacturing", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lineId, action }),
    });
    const payload = (await response.json()) as ManufacturingResponse;
    setBusy(false);
    if (!response.ok) {
      setError(payload.error ?? `Failed to ${action} manufacturing.`);
      return;
    }
    queryClient.setQueryData(queryKeys.productionStatus(selectedBusinessId), payload.status);
    void queryClient.invalidateQueries({ queryKey: queryKeys.productionPage });
  }

  return (
    <div className="anim">
      <header className="lc-page-header">
        <div>
          <h1>Production</h1>
          <p>Your lines and jobs.</p>
        </div>
        <div style={{ alignSelf: "center" }}>
          <Link href="/dashboard">Back to Dashboard</Link>
        </div>
      </header>

      {productionPageQuery.isFetching || manufacturingStatusQuery.isFetching ? <p>Refreshing production data...</p> : null}
      {error ? <p style={{ color: "#f87171" }}>{error}</p> : null}

      <section>
        <h2 style={{ marginTop: 0 }}>Manufacturing Job</h2>
        <label>
          Business
          <select
            value={selectedBusinessId}
            onChange={(event) => {
              const nextBusinessId = event.target.value;
              setSelectedBusinessId(nextBusinessId);
              if (nextBusinessId) {
                void queryClient.prefetchQuery({
                  queryKey: queryKeys.productionStatus(nextBusinessId),
                  queryFn: async () => {
                    const payload = await apiGet<ManufacturingResponse>(`/api/production/manufacturing?businessId=${nextBusinessId}`, {
                      fallbackError: "Failed to load manufacturing status.",
                    });
                    return payload.status;
                  },
                }).catch((err) => setError(err instanceof Error ? err.message : "Failed to load manufacturing status."));
              }
            }}
            title="Business"
          >
            <option value="">Select manufacturing business</option>
            {manufacturingBusinesses.map((business) => (
              <option key={business.id} value={business.id}>{business.name} ({business.type})</option>
            ))}
          </select>
        </label>

        {manufacturing ? (
          <div style={{ marginTop: 12, display: "grid", gap: 8 }}>
            <p style={{ margin: 0 }}><strong>Lines:</strong> {manufacturing.summary.active} active / {manufacturing.maxLines} total</p>
            {manufacturing.lines.map((line) => (
              <div key={line.id} style={{ display: "grid", gap: 6, padding: 12, border: "1px solid var(--border-subtle)", borderRadius: 8 }}>
                <p style={{ margin: 0 }}><strong>Line #{line.line_number}:</strong> {line.status}</p>
                <p style={{ margin: 0 }}><strong>Worker assigned:</strong> {line.worker_assigned ? "Yes" : "No"}</p>
                <p style={{ margin: 0 }}><strong>Last Tick:</strong> {line.last_tick_at ?? "Never"}</p>
                <label>
                  Tooling
                  <select value={line.configured_recipe_key ?? ""} onChange={(event) => void setRecipe(line.id, event.target.value)} title="Recipe" disabled={busy || line.status === "retooling"}>
                    <option value="">Select recipe</option>
                    {line.available_recipes.map((recipe) => (
                      <option key={recipe.key} value={recipe.key}>{recipe.displayName}</option>
                    ))}
                  </select>
                </label>
                <div style={{ display: "flex", gap: 8 }}>
                  <button onClick={() => void setRunning(line.id, "start")} disabled={busy || !line.configured_recipe_key || !line.worker_assigned || line.status === "retooling"}>Start</button>
                  <button onClick={() => void setRunning(line.id, "stop")} disabled={busy}>Stop</button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p style={{ marginTop: 12, color: "#94a3b8" }}>Select a manufacturing business to manage its job.</p>
        )}
      </section>
    </div>
  );
}
