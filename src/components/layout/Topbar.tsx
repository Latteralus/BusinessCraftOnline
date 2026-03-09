"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { OnlinePlayerPreview } from "@/domains/auth-character";
import { formatCurrency } from "@/lib/formatters";

interface TopbarProps {
  initials: string;
  firstName: string;
  lastName: string;
}

export function Topbar({
  initials,
  firstName,
  lastName,
}: TopbarProps) {
  const pathname = usePathname();
  const [playerCount, setPlayerCount] = useState<number | null>(null);
  const [onlinePlayers, setOnlinePlayers] = useState<OnlinePlayerPreview[]>([]);
  const [notificationsCount, setNotificationsCount] = useState<number | null>(null);
  const [isOnlineListOpen, setIsOnlineListOpen] = useState(false);
  const onlineListRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadShellMetrics() {
      const response = await fetch("/api/app-shell", { cache: "no-store" });
      const payload = (await response.json().catch(() => null)) as
        | { playerCount?: number; onlinePlayers?: OnlinePlayerPreview[]; notificationsCount?: number }
        | null;

      if (!response.ok || cancelled) {
        return;
      }

      setPlayerCount(payload?.playerCount ?? 0);
      setOnlinePlayers(payload?.onlinePlayers ?? []);
      setNotificationsCount(payload?.notificationsCount ?? 0);
    }

    void loadShellMetrics();
    const interval = window.setInterval(() => {
      void loadShellMetrics();
    }, 60 * 1000);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    const heartbeat = window.setInterval(() => {
      void fetch("/api/app-shell", { method: "POST", cache: "no-store" }).catch(() => null);
    }, 60 * 1000);

    return () => window.clearInterval(heartbeat);
  }, []);

  useEffect(() => {
    function handleOutsideClick(event: MouseEvent) {
      if (!onlineListRef.current?.contains(event.target as Node)) {
        setIsOnlineListOpen(false);
      }
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsOnlineListOpen(false);
      }
    }

    document.addEventListener("mousedown", handleOutsideClick);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleOutsideClick);
      document.removeEventListener("keydown", handleEscape);
    };
  }, []);

  return (
    <div className="topbar">
      <div className="topbar-left">
        <div className="logo">Life<span>Craft</span>Online</div>
        <div className="server-badge-wrap" ref={onlineListRef}>
          <button
            type="button"
            className={`server-badge server-badge-button ${isOnlineListOpen ? "is-open" : ""}`}
            onClick={() => setIsOnlineListOpen((value) => !value)}
            aria-haspopup="dialog"
            aria-expanded={isOnlineListOpen}
          >
            <div className="server-dot"></div>
            Players Online: {playerCount ?? "..."}
          </button>
          {isOnlineListOpen ? (
            <div className="online-players-popover" role="dialog" aria-label="Online players">
              <div className="online-players-header">
                <div>Online Characters</div>
                <div>{onlinePlayers.length}</div>
              </div>
              {onlinePlayers.length > 0 ? (
                <div className="online-players-list">
                  {onlinePlayers.map((player, index) => (
                    <Link
                      key={player.player_id}
                      href={`/players/${player.player_id}`}
                      className="online-player-row"
                      onClick={() => setIsOnlineListOpen(false)}
                    >
                      <div className="online-player-rank">#{index + 1}</div>
                      <div className="online-player-main">
                        <div className="online-player-name">{player.character_name}</div>
                        <div className="online-player-meta">Wealth {formatCurrency(player.wealth)}</div>
                      </div>
                      <div className="online-player-wealth">Active now</div>
                    </Link>
                  ))}
                </div>
              ) : (
                <div className="online-players-empty">No online characters found.</div>
              )}
            </div>
          ) : null}
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
            <div className="avatar-level">Active operator</div>
          </div>
        </div>
      </div>
    </div>
  );
}
