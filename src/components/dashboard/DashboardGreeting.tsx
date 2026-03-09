"use client";

import { useEffect, useState } from "react";

function getGreetingForHour(hour: number): string {
  if (hour < 5) return "Working late?";
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  if (hour < 22) return "Good evening";
  return "Working late?";
}

type Props = {
  firstName: string;
};

export function DashboardGreeting({ firstName }: Props) {
  const [greeting, setGreeting] = useState("Welcome back");

  useEffect(() => {
    const updateGreeting = () => {
      setGreeting(getGreetingForHour(new Date().getHours()));
    };

    updateGreeting();
    const interval = window.setInterval(updateGreeting, 60 * 1000);

    return () => window.clearInterval(interval);
  }, []);

  return <h1>{greeting}, {firstName}</h1>;
}
