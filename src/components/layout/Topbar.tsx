"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

interface TopbarProps {
  initials: string;
  firstName: string;
  lastName: string;
  businessLevel: number;
}

export function Topbar({
  initials,
  firstName,
  lastName,
  businessLevel,
}: TopbarProps) {
  const pathname = usePathname();
  const [playerCount, setPlayerCount] = useState<number | null>(null);
  const [notificationsCount, setNotificationsCount] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadShellMetrics() {
      const response = await fetch("/api/app-shell", { cache: "no-store" });
      const payload = (await response.json().catch(() => null)) as
        | { playerCount?: number; notificationsCount?: number }
        | null;

      if (!response.ok || cancelled) {
        return;
      }

      setPlayerCount(payload?.playerCount ?? 0);
      setNotificationsCount(payload?.notificationsCount ?? 0);
    }

    void loadShellMetrics();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="topbar">
      <div className="topbar-left">
        <div className="logo">Life<span>Craft</span>Online</div>
        <div className="server-badge">
          <div className="server-dot"></div>
          Players Online: {playerCount ?? "..."}
        </div>
      </div>
      <div className="topbar-nav">
        <Link href="/dashboard" className={pathname === "/dashboard" ? "active" : ""}>Dashboard</Link>
        <Link href="/businesses" className={pathname === "/businesses" ? "active" : ""}>My Businesses</Link>
        <Link href="/market" className={pathname === "/market" ? "active" : ""}>Market</Link>
        <Link href="/production" className={pathname === "/production" ? "active" : ""}>Manufacturing</Link>
        <Link href="/banking" className={pathname === "/banking" ? "active" : ""}>Banking</Link>
        <Link href="/contracts" className={pathname === "/contracts" ? "active" : ""}>Contracts</Link>
        <Link href="/inventory" className={pathname === "/inventory" ? "active" : ""}>Inventory</Link>
      </div>
      <div className="topbar-right">
        <div className="icon-btn" title="Messages">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>
        </div>
        <div className="icon-btn" title="Storefront alerts">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 01-3.46 0"/></svg>
          {(notificationsCount ?? 0) > 0 ? <div className="notif-badge">{notificationsCount}</div> : null}
        </div>
        <div className="avatar-btn">
          <div className="avatar-circle">{initials}</div>
          <div className="avatar-info">
            <div className="avatar-name">{firstName} {lastName}</div>
            <div className="avatar-level">Biz Level {businessLevel}</div>
          </div>
        </div>
      </div>
    </div>
  );
}
