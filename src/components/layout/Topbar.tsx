"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { createClient } from "@supabase/supabase-js";
import { useEffect, useRef, useState, type FormEvent } from "react";
import type { OnlinePlayerPreview } from "@/domains/auth-character";
import type { ChatMessage } from "@/domains/chat";
import { formatCurrency } from "@/lib/formatters";

const CHAT_MESSAGE_LIMIT = 50;

function formatChatTimestamp(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "--:--";
  }

  return date.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function mergeChatMessages(current: ChatMessage[], incoming: ChatMessage[]) {
  const merged = new Map<string, ChatMessage>();

  for (const message of current) {
    merged.set(message.id, message);
  }

  for (const message of incoming) {
    merged.set(message.id, message);
  }

  return Array.from(merged.values())
    .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
    .slice(-CHAT_MESSAGE_LIMIT);
}

interface TopbarProps {
  initials?: string;
  firstName?: string;
  lastName?: string;
}

export function Topbar({
  initials,
  firstName,
  lastName,
}: TopbarProps) {
  const pathname = usePathname();
  const [identity, setIdentity] = useState(() => ({
    initials: initials ?? "··",
    firstName: firstName ?? "",
    lastName: lastName ?? "",
    loaded: Boolean(initials && firstName && lastName),
  }));
  const [playerCount, setPlayerCount] = useState<number | null>(null);
  const [onlinePlayers, setOnlinePlayers] = useState<OnlinePlayerPreview[]>([]);
  const [notificationsCount, setNotificationsCount] = useState<number | null>(null);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatUnreadCount, setChatUnreadCount] = useState(0);
  const [chatInput, setChatInput] = useState("");
  const [chatError, setChatError] = useState<string | null>(null);
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [isChatLoading, setIsChatLoading] = useState(true);
  const [isSendingChat, setIsSendingChat] = useState(false);
  const [isOnlineListOpen, setIsOnlineListOpen] = useState(false);
  const onlineListRef = useRef<HTMLDivElement | null>(null);
  const chatRef = useRef<HTMLDivElement | null>(null);
  const chatScrollRef = useRef<HTMLDivElement | null>(null);
  const isChatOpenRef = useRef(false);

  useEffect(() => {
    setIdentity({
      initials: initials ?? "··",
      firstName: firstName ?? "",
      lastName: lastName ?? "",
      loaded: Boolean(initials && firstName && lastName),
    });
  }, [firstName, initials, lastName]);

  useEffect(() => {
    let cancelled = false;

    async function loadIdentity() {
      const response = await fetch("/api/auth/me", { cache: "no-store" });
      const payload = (await response.json().catch(() => null)) as
        | {
            character?: { first_name?: string | null; last_name?: string | null } | null;
          }
        | null;

      if (!response.ok || cancelled || !payload?.character?.first_name || !payload.character.last_name) {
        return;
      }

      const resolvedFirstName = payload.character.first_name;
      const resolvedLastName = payload.character.last_name;

      setIdentity({
        initials: `${resolvedFirstName[0] ?? ""}${resolvedLastName[0] ?? ""}` || "··",
        firstName: resolvedFirstName,
        lastName: resolvedLastName,
        loaded: true,
      });
    }

    if (!identity.loaded) {
      void loadIdentity();
    }

    return () => {
      cancelled = true;
    };
  }, [identity.loaded]);

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
    let cancelled = false;

    async function loadChatMessages() {
      setIsChatLoading(true);
      const response = await fetch("/api/chat", { cache: "no-store" });
      const payload = (await response.json().catch(() => null)) as
        | { messages?: ChatMessage[]; error?: string }
        | null;

      if (cancelled) {
        return;
      }

      if (!response.ok) {
        setChatError(payload?.error ?? "Failed to load chat.");
        setIsChatLoading(false);
        return;
      }

      setChatMessages(mergeChatMessages([], payload?.messages ?? []));
      setChatError(null);
      setIsChatLoading(false);
    }

    void loadChatMessages();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const heartbeat = window.setInterval(() => {
      void fetch("/api/app-shell", { method: "POST", cache: "no-store" }).catch(() => null);
    }, 60 * 1000);

    return () => window.clearInterval(heartbeat);
  }, []);

  useEffect(() => {
    isChatOpenRef.current = isChatOpen;
    if (isChatOpen) {
      setChatUnreadCount(0);
    }
  }, [isChatOpen]);

  useEffect(() => {
    let isCancelled = false;
    let removeChannel: (() => void) | null = null;

    async function connectChatRealtime() {
      const response = await fetch("/api/realtime-auth", { cache: "no-store" });
      const payload = (await response.json().catch(() => null)) as
        | { token?: string; error?: string }
        | null;

      if (!response.ok || !payload?.token || isCancelled) {
        return;
      }

      const supabase = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
        {
          auth: {
            persistSession: false,
            autoRefreshToken: false,
          },
          global: {
            headers: {
              Authorization: `Bearer ${payload.token}`,
            },
          },
        }
      );

      supabase.realtime.setAuth(payload.token);

      const channel = supabase
        .channel(`global-chat-${Date.now()}`)
        .on(
          "postgres_changes",
          {
            event: "INSERT",
            schema: "public",
            table: "chat_messages",
          },
          (change) => {
            const message = change.new as ChatMessage;
            setChatMessages((current) => mergeChatMessages(current, [message]));
            setChatError(null);
            setIsChatLoading(false);

            if (!isChatOpenRef.current) {
              setChatUnreadCount((current) => current + 1);
            }
          }
        )
        .subscribe();

      removeChannel = () => {
        void supabase.removeChannel(channel);
      };
    }

    void connectChatRealtime();

    return () => {
      isCancelled = true;
      removeChannel?.();
    };
  }, []);

  useEffect(() => {
    if (!isChatOpen) {
      return;
    }

    chatScrollRef.current?.scrollTo({
      top: chatScrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [chatMessages, isChatOpen]);

  useEffect(() => {
    function handleOutsideClick(event: MouseEvent) {
      if (!onlineListRef.current?.contains(event.target as Node)) {
        setIsOnlineListOpen(false);
      }
      if (!chatRef.current?.contains(event.target as Node)) {
        setIsChatOpen(false);
      }
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsOnlineListOpen(false);
        setIsChatOpen(false);
      }
    }

    document.addEventListener("mousedown", handleOutsideClick);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleOutsideClick);
      document.removeEventListener("keydown", handleEscape);
    };
  }, []);

  async function handleSendChatMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const message = chatInput.trim();

    if (!message || isSendingChat) {
      return;
    }

    setIsSendingChat(true);
    setChatError(null);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ message }),
      });

      const payload = (await response.json().catch(() => null)) as
        | { message?: ChatMessage; error?: string }
        | null;

      if (!response.ok) {
        setChatError(payload?.error ?? "Failed to send chat message.");
        return;
      }

      if (payload?.message) {
        setChatMessages((current) => mergeChatMessages(current, [payload.message as ChatMessage]));
      }

      setChatInput("");
    } catch {
      setChatError("Failed to send chat message.");
    } finally {
      setIsSendingChat(false);
    }
  }

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
        <div className="topbar-chat-wrap" ref={chatRef}>
          <button
            type="button"
            className={`icon-btn ${isChatOpen ? "is-open" : ""}`}
            title="Messages"
            aria-haspopup="dialog"
            aria-expanded={isChatOpen}
            onClick={() => {
              setIsChatOpen((value) => !value);
              setIsOnlineListOpen(false);
            }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>
            {chatUnreadCount > 0 ? <div className="notif-badge">{Math.min(chatUnreadCount, 99)}</div> : null}
          </button>
          {isChatOpen ? (
            <div className="chat-popover" role="dialog" aria-label="Global chat">
              <div className="chat-header">
                <div>Global Chat</div>
                <div>{chatMessages.length}</div>
              </div>
              <div className="chat-message-list" ref={chatScrollRef}>
                {isChatLoading ? <div className="chat-empty">Loading chat...</div> : null}
                {!isChatLoading && chatMessages.length === 0 ? (
                  <div className="chat-empty">No messages yet. Start the conversation.</div>
                ) : null}
                {!isChatLoading
                  ? chatMessages.map((message) => (
                      <div className="chat-message-row" key={message.id}>
                        <span className="chat-message-time">[{formatChatTimestamp(message.created_at)}]</span>
                        <span className="chat-message-separator"> - </span>
                        <span className="chat-message-name">{message.character_first_name}</span>
                        <span className="chat-message-separator">: </span>
                        <span className="chat-message-text">{message.message}</span>
                      </div>
                    ))
                  : null}
              </div>
              <form className="chat-form" onSubmit={handleSendChatMessage}>
                <input
                  className="chat-input"
                  type="text"
                  value={chatInput}
                  onChange={(event) => setChatInput(event.target.value)}
                  placeholder="Send a message to all players"
                  maxLength={280}
                />
                <button className="chat-send-btn" type="submit" disabled={isSendingChat || chatInput.trim().length === 0}>
                  Send
                </button>
              </form>
              <div className="chat-footer">
                <span>{chatInput.trim().length}/280</span>
                <span>{chatError ?? "Live updates enabled"}</span>
              </div>
            </div>
          ) : null}
        </div>
        <div className="icon-btn" title="Storefront alerts">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 01-3.46 0"/></svg>
          {(notificationsCount ?? 0) > 0 ? <div className="notif-badge">{notificationsCount}</div> : null}
        </div>
        <div className={`avatar-btn ${identity.loaded ? "" : "avatar-btn-loading"}`.trim()}>
          <div className="avatar-circle">{identity.initials}</div>
          <div className="avatar-info">
            <div className="avatar-name">
              {identity.loaded ? `${identity.firstName} ${identity.lastName}` : "Loading profile"}
            </div>
            <div className="avatar-level">Active operator</div>
          </div>
        </div>
      </div>
    </div>
  );
}
