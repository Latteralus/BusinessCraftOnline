"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type ActiveOperation = {
  id: string;
  businessId: string;
  name: string;
  detail: string;
  running: boolean;
  statusLabel: string;
  intervalSeconds: number;
  lastProgressAt: string | null;
};

type Props = {
  operations: ActiveOperation[];
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function getProgressPercent(lastProgressAt: string | null, intervalSeconds: number, running: boolean, nowMs: number): number {
  if (!running || !lastProgressAt || intervalSeconds <= 0) return 0;

  const startedAtMs = new Date(lastProgressAt).getTime();
  if (!Number.isFinite(startedAtMs)) return 0;

  const intervalMs = intervalSeconds * 1000;
  const elapsedMs = Math.max(0, nowMs - startedAtMs);
  const cycleElapsedMs = elapsedMs % intervalMs;
  return clamp((cycleElapsedMs / intervalMs) * 100, 0, 100);
}

function formatCountdown(lastProgressAt: string | null, intervalSeconds: number, running: boolean, nowMs: number): string {
  if (!running || !lastProgressAt || intervalSeconds <= 0) return "Not Producing";

  const startedAtMs = new Date(lastProgressAt).getTime();
  if (!Number.isFinite(startedAtMs)) return "Running";

  const intervalMs = intervalSeconds * 1000;
  const elapsedMs = Math.max(0, nowMs - startedAtMs);
  const cycleElapsedMs = elapsedMs % intervalMs;
  const remainingSeconds =
    cycleElapsedMs === 0 && elapsedMs > 0
      ? intervalSeconds
      : Math.max(0, Math.ceil((intervalMs - cycleElapsedMs) / 1000));
  const minutes = Math.floor(remainingSeconds / 60);
  const seconds = remainingSeconds % 60;

  return `${minutes}:${seconds.toString().padStart(2, "0")} left`;
}

export function ActiveOperationsCard({ operations }: Props) {
  const [nowMs, setNowMs] = useState<number | null>(null);

  useEffect(() => {
    setNowMs(Date.now());

    const interval = window.setInterval(() => {
      setNowMs(Date.now());
    }, 1000);

    return () => window.clearInterval(interval);
  }, []);

  return (
    <div className="card anim anim-d4">
      <div className="card-header">
        <div className="card-title">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M2 20h20M5 20V8l5 4V4l5 8h5v8" /></svg>
          Active Operations
        </div>
        <Link href="/businesses" prefetch={false} className="card-action">Manage →</Link>
      </div>
      <div className="card-body card-body-scroll">
        {operations.length > 0 ? (
          operations.map((op) => {
            const progressPercent = nowMs === null
              ? 0
              : getProgressPercent(op.lastProgressAt, op.intervalSeconds, op.running, nowMs);
            const countdown = nowMs === null
              ? (op.running ? "Loading..." : "Not Producing")
              : formatCountdown(op.lastProgressAt, op.intervalSeconds, op.running, nowMs);

            return (
              <Link
                href={`/businesses/${op.businessId}?tab=operations`}
                prefetch={false}
                key={op.id}
                style={{ textDecoration: "none", color: "inherit", display: "block" }}
              >
                <div className="mfg-item" style={{ cursor: "pointer", transition: "transform 0.2s" }}>
                  <div className="mfg-top">
                    <div className="mfg-name">{op.name}</div>
                    <div className="mfg-recipe" style={{ textTransform: "capitalize" }}>{op.detail}</div>
                  </div>
                  <div
                    className="mfg-bar-track"
                    style={{
                      position: "relative",
                      overflow: "hidden",
                    }}
                  >
                    <div
                      className={`mfg-bar-fill ${op.running ? "anim-pulse" : ""}`}
                      style={{
                        width: `${progressPercent.toFixed(0)}%`,
                        background: op.running ? "var(--accent-green)" : "var(--accent-red)",
                      }}
                    />
                    <div
                      style={{
                        position: "absolute",
                        top: "50%",
                        left: `calc(${progressPercent.toFixed(0)}% - 7px)`,
                        width: 14,
                        height: 14,
                        borderRadius: 999,
                        transform: "translateY(-50%)",
                        background: op.running ? "#dcfce7" : "#fecaca",
                        boxShadow: op.running
                          ? "0 0 0 4px rgba(34,197,94,0.18), 0 0 14px rgba(34,197,94,0.35)"
                          : "0 0 0 4px rgba(248,113,113,0.14), 0 0 14px rgba(248,113,113,0.3)",
                        transition: "left 900ms linear",
                      }}
                    />
                  </div>
                  <div className="mfg-bottom">
                    <div className="mfg-inputs">
                      <span className={`input-chip ${op.running ? "input-filled" : "input-empty"}`}>
                        Status: {op.statusLabel}
                      </span>
                      <span className={`input-chip ${op.running ? "input-filled" : "input-empty"}`}>
                        Cycle: {progressPercent.toFixed(0)}%
                      </span>
                    </div>
                    <div
                      className="mfg-countdown"
                      style={{ color: op.running ? "var(--accent-green)" : "var(--accent-red)" }}
                    >
                      {countdown}
                    </div>
                  </div>
                </div>
              </Link>
            );
          })
        ) : (
          <div className="mfg-item" style={{ opacity: 0.5 }}>
            <div className="mfg-top">
              <div className="mfg-name">No active production</div>
              <div className="mfg-recipe">Assign workers to start</div>
            </div>
            <div className="mfg-bar-track" style={{ position: "relative", overflow: "hidden" }}>
              <div className="mfg-bar-fill" style={{ width: "0%", background: "var(--accent-red)" }} />
              <div
                style={{
                  position: "absolute",
                  top: "50%",
                  left: "-2px",
                  width: 14,
                  height: 14,
                  borderRadius: 999,
                  transform: "translateY(-50%)",
                  background: "#fecaca",
                  boxShadow: "0 0 0 4px rgba(248,113,113,0.14), 0 0 14px rgba(248,113,113,0.3)",
                }}
              />
            </div>
            <div className="mfg-bottom">
              <div className="mfg-inputs">
                <span className="input-chip input-empty">Worker: Resting/None</span>
              </div>
              <div className="mfg-countdown" style={{ color: "var(--accent-red)" }}>Halted</div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
