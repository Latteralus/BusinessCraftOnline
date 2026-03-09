"use client";

import { useEffect, useState } from "react";
import { WAGE_TICK_MINUTES } from "@/config/employees";

function formatCountdownToInterval(now: Date, intervalMinutes: number): string {
  const intervalMs = intervalMinutes * 60 * 1000;
  const nextBoundaryMs = Math.ceil(now.getTime() / intervalMs) * intervalMs;
  const remainingMs = Math.max(0, nextBoundaryMs - now.getTime());
  const remainingTotalSeconds = Math.floor(remainingMs / 1000);
  const minutes = Math.floor(remainingTotalSeconds / 60);
  const seconds = remainingTotalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

export function DashboardClock() {
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    // Initial set
    setNow(new Date());

    // Update every second
    const interval = setInterval(() => {
      setNow(new Date());
    }, 1000);

    return () => clearInterval(interval);
  }, []);

  // Avoid hydration mismatch by rendering nothing or a placeholder on the server
  if (!now) {
    return (
      <div className="game-clock">
        <div className="time" id="gameClock">
          00:00:00
        </div>
        <div className="date">Loading...</div>
        <div className="next-tick-label">
          <span className="dot"></span> Wage Tick in <span id="tickTimer">...</span>
        </div>
      </div>
    );
  }

  const timeString = now.toLocaleTimeString("en-US", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

  const formattedCountdown = formatCountdownToInterval(now, WAGE_TICK_MINUTES);

  return (
    <div className="game-clock">
      <div className="time" id="gameClock">
        {timeString}
      </div>
      <div className="date">Dashboard Active</div>
      <div className="next-tick-label">
        <span className="dot" style={{ animation: "pulse 2s infinite" }}></span> Wage Tick in{" "}
        <span id="tickTimer">{formattedCountdown}</span>
      </div>
    </div>
  );
}
