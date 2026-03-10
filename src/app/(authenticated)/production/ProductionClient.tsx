"use client";

import { PRODUCTION_RETOOL_DURATION_MINUTES } from "@/config/production";
import { supportsManufacturing } from "@/domains/businesses";
import type { ManufacturingStatusView } from "@/domains/production";
import { apiGet } from "@/lib/client/api";
import type { ProductionPageData } from "@/lib/client/queries";
import { TooltipLabel } from "@/components/ui/tooltip";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useGameStore, useProductionSlice } from "@/stores/game-store";

type Props = {
  initialData: ProductionPageData;
};

type ManufacturingResponse = { status: ManufacturingStatusView; error?: string };

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function formatCountdown(ms: number) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function getRetoolProgress(retoolCompleteAt: string | null, nowMs: number) {
  if (!retoolCompleteAt) return null;
  const completeMs = new Date(retoolCompleteAt).getTime();
  if (!Number.isFinite(completeMs)) return null;
  const startMs = completeMs - PRODUCTION_RETOOL_DURATION_MINUTES * 60_000;
  return {
    progress: clamp((nowMs - startMs) / (completeMs - startMs), 0, 1),
    remainingMs: Math.max(0, completeMs - nowMs),
  };
}

function getLiveOutputProgress(lastTickAt: string | null, baseProgress: number, perMinute: number, nowMs: number) {
  const normalizedBase = clamp(baseProgress, 0, 0.999);
  if (!lastTickAt || perMinute <= 0) return normalizedBase;
  const anchorMs = new Date(lastTickAt).getTime();
  if (!Number.isFinite(anchorMs)) return normalizedBase;
  const elapsedMinutes = Math.max(0, (nowMs - anchorMs) / 60_000);
  const unitsProgress = normalizedBase + elapsedMinutes * perMinute;
  return unitsProgress - Math.floor(unitsProgress);
}

export default function ProductionClient({ initialData }: Props) {
  const production = useProductionSlice();
  const setProduction = useGameStore((state) => state.setProduction);
  const patchProduction = useGameStore((state) => state.patchProduction);
  const businesses = production.businesses.length > 0 ? production.businesses : initialData.businesses;
  const [selectedBusinessId, setSelectedBusinessId] = useState(production.selectedBusinessId || initialData.selectedBusinessId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(Date.now());
  const manufacturing =
    selectedBusinessId === production.selectedBusinessId
      ? production.manufacturing
      : selectedBusinessId === initialData.selectedBusinessId
        ? initialData.manufacturing
        : null;

  const manufacturingBusinesses = useMemo(
    () =>
      businesses.filter((business) => supportsManufacturing(business.type)),
    [businesses]
  );

  useEffect(() => {
    const interval = window.setInterval(() => {
      setNowMs(Date.now());
    }, 1000);
    return () => window.clearInterval(interval);
  }, []);

  async function loadBusinessStatus(businessId: string) {
    const payload = await apiGet<ManufacturingResponse>(`/api/production/manufacturing?businessId=${businessId}`, {
      fallbackError: "Failed to load manufacturing status.",
    });
    setProduction({
      businesses,
      selectedBusinessId: businessId,
      manufacturing: payload.status,
    });
  }

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
    patchProduction({ selectedBusinessId, manufacturing: payload.status });
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
    patchProduction({ selectedBusinessId, manufacturing: payload.status });
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

      {busy ? <p>Refreshing production data...</p> : null}
      {error ? <p style={{ color: "#f87171" }}>{error}</p> : null}

      <section>
        <h2 style={{ marginTop: 0 }}>Manufacturing Job</h2>
        <label>
          <TooltipLabel label="Business" content="Select the manufacturing business whose lines you want to inspect and control." />
          <select
            value={selectedBusinessId}
            onChange={(event) => {
              const nextBusinessId = event.target.value;
              setSelectedBusinessId(nextBusinessId);
              if (nextBusinessId) {
                void loadBusinessStatus(nextBusinessId).catch((err) =>
                  setError(err instanceof Error ? err.message : "Failed to load manufacturing status.")
                );
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
                {(() => {
                  const retool = getRetoolProgress(line.retool_complete_at, nowMs);
                  const progress = retool
                    ? retool.progress
                    : getLiveOutputProgress(
                        line.last_tick_at,
                        line.output_progress,
                        line.status === "active" ? line.configured_recipe?.baseOutputQuantity ?? 0 : 0,
                        nowMs
                      );
                  const color = retool ? "#c084fc" : line.status === "active" ? "#22c55e" : "#60a5fa";
                  return (
                    <div style={{ display: "grid", gap: 6 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, fontSize: 12 }}>
                        <span style={{ color: "var(--text-secondary)" }}>
                          {retool ? "Retool progress" : "Live output cycle"}
                        </span>
                        <strong style={{ color }}>
                          {retool ? formatCountdown(retool.remainingMs) : `${Math.round(progress * 100)}%`}
                        </strong>
                      </div>
                      <div style={{ position: "relative", height: 10, borderRadius: 999, background: "rgba(148,163,184,0.1)", overflow: "hidden" }}>
                        <div
                          style={{
                            width: `${progress * 100}%`,
                            height: "100%",
                            background: color,
                            borderRadius: 999,
                            transition: "width 900ms linear",
                          }}
                        />
                        <div
                          style={{
                            position: "absolute",
                            top: "50%",
                            left: `calc(${progress * 100}% - 6px)`,
                            width: 12,
                            height: 12,
                            borderRadius: 999,
                            transform: "translateY(-50%)",
                            background: color,
                            boxShadow: `0 0 0 3px ${color}22, 0 0 12px ${color}66`,
                            transition: "left 900ms linear",
                          }}
                        />
                      </div>
                    </div>
                  );
                })()}
                <label>
                  <TooltipLabel label="Tooling" content="Choose the recipe configured on this line. Retooling prevents immediate production changes." />
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
