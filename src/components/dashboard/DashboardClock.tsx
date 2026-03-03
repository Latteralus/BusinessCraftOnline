"use client";

import { useEffect, useState } from "react";

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
          <span className="dot"></span> Mfg tick in <span id="tickTimer">...</span>
        </div>
      </div>
    );
  }

  // Format the time as HH:MM:SS in Eastern Time (America/New_York)
  const timeString = now.toLocaleTimeString("en-US", {
    timeZone: "America/New_York",
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

  // Calculate next 10-minute tick (e.g. 10:00, 10:10, 10:20)
  // Get minutes in Eastern Time using Intl.DateTimeFormat
  const etMinutesFormatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    minute: "numeric",
  });
  const currentMinutes = parseInt(etMinutesFormatter.format(now), 10);
  const currentSeconds = now.getSeconds();
  
  const minutesToNextTick = 9 - (currentMinutes % 10);
  const secondsToNextTick = 59 - currentSeconds;
  
  const formattedCountdown = `${minutesToNextTick}:${secondsToNextTick.toString().padStart(2, "0")}`;

  return (
    <div className="game-clock">
      <div className="time" id="gameClock">
        {timeString}
      </div>
      <div className="date">Dashboard Active</div>
      <div className="next-tick-label">
        <span className="dot" style={{ animation: "pulse 2s infinite" }}></span> Mfg tick in{" "}
        <span id="tickTimer">{formattedCountdown}</span>
      </div>
    </div>
  );
}
