"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import type { OnlinePlayerPreview } from "@/domains/auth-character";
import type { ChatMessage } from "@/domains/chat";
import { formatCurrency } from "@/lib/formatters";
import { apiPost } from "@/lib/client/api";
import { fetchChatMessages } from "@/lib/client/queries";
import { runOptimisticUpdate } from "@/stores/optimistic";
import { useAppShellSlice, useChatSlice, useGameStore, usePlayerSlice } from "@/stores/game-store";

const CHAT_MESSAGE_LIMIT = 50;
const CHAT_LAST_VIEWED_STORAGE_KEY = "lco-chat-last-viewed-at";

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

export function Topbar() {
  const pathname = usePathname();
  const identity = usePlayerSlice();
  const appShell = useAppShellSlice();
  const chatMessages = useChatSlice();
  const patchChat = useGameStore((state) => state.patchChat);
  const setChat = useGameStore((state) => state.setChat);
  const removeChatMessage = useGameStore((state) => state.removeChatMessage);
  const patchAppShell = useGameStore((state) => state.patchAppShell);
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
  const hasInitializedChatRef = useRef(false);
  const [lastViewedChatAt, setLastViewedChatAt] = useState<string | null>(() => {
    if (typeof window === "undefined") {
      return null;
    }

    return window.localStorage.getItem(CHAT_LAST_VIEWED_STORAGE_KEY);
  });
  const lastViewedChatAtRef = useRef<string | null>(lastViewedChatAt);
  const playerCount = appShell.playerCount;
  const onlinePlayers = appShell.onlinePlayers as OnlinePlayerPreview[];
  const notificationsCount = appShell.notificationsCount;
  const isRealtimeConnected = appShell.connectionStatus === "connected";
  const identityLoaded = Boolean(identity.playerId && identity.firstName && identity.lastName);
  const chatUnreadCount =
    !isChatOpen && lastViewedChatAt
      ? chatMessages.filter((message) => new Date(message.created_at).getTime() > new Date(lastViewedChatAt).getTime()).length
      : 0;

  function getLatestChatTimestamp(messages: ChatMessage[]) {
    return messages[messages.length - 1]?.created_at ?? null;
  }

  function markChatViewed(timestamp: string | null) {
    lastViewedChatAtRef.current = timestamp;
    setLastViewedChatAt(timestamp);

    if (typeof window === "undefined") {
      return;
    }

    if (timestamp) {
      window.localStorage.setItem(CHAT_LAST_VIEWED_STORAGE_KEY, timestamp);
    } else {
      window.localStorage.removeItem(CHAT_LAST_VIEWED_STORAGE_KEY);
    }
  }

  function applyIncomingMessages(incoming: ChatMessage[]) {
    const latestMergedTimestamp = getLatestChatTimestamp(incoming);
    if (!hasInitializedChatRef.current) {
      hasInitializedChatRef.current = true;
      if (!lastViewedChatAtRef.current) {
        markChatViewed(latestMergedTimestamp);
      }
      return;
    }

    if (isChatOpenRef.current) {
      markChatViewed(latestMergedTimestamp);
    }
  }

  useEffect(() => {
    if (chatMessages.length > 0) {
      applyIncomingMessages(chatMessages);
      setIsChatLoading(false);
      return;
    }

    let cancelled = false;
    setIsChatLoading(true);
    void fetchChatMessages()
      .then((data) => {
        if (cancelled) {
          return;
        }
        const messages = data.messages ?? [];
        setChat(messages);
        applyIncomingMessages(messages);
        setChatError(null);
      })
      .catch((error) => {
        if (!cancelled) {
          setChatError(error instanceof Error ? error.message : "Failed to load chat.");
        }
      })
      .finally(() => {
        if (!cancelled) {
          setIsChatLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [chatMessages.length, setChat]);

  useEffect(() => {
    patchAppShell({ unreadChatCount: chatUnreadCount });
  }, [chatUnreadCount, patchAppShell]);

  useEffect(() => {
    const heartbeat = window.setInterval(() => {
      void fetch("/api/app-shell", { method: "POST" }).catch(() => null);
    }, 60 * 1000);

    return () => window.clearInterval(heartbeat);
  }, []);

  useEffect(() => {
    isChatOpenRef.current = isChatOpen;
    if (isChatOpen) {
      markChatViewed(getLatestChatTimestamp(chatMessages));
    }
  }, [chatMessages, isChatOpen]);

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

    const optimisticMessage: ChatMessage = {
      id: `optimistic-${Date.now()}`,
      player_id: identity.playerId ?? "me",
      character_first_name: identity.firstName || "You",
      message,
      created_at: new Date().toISOString(),
    };

    setIsSendingChat(true);
    setChatError(null);

    try {
      await runOptimisticUpdate("chat", () => {
        patchChat(optimisticMessage);
      }, async () => {
        const payload = await apiPost<{ message?: ChatMessage; error?: string }>("/api/chat", { message }, { fallbackError: "Failed to send chat message." });
        removeChatMessage(optimisticMessage.id);
        if (payload.message) {
          patchChat(payload.message);
        }
        return payload;
      });
      setChatInput("");
    } catch (error) {
      setChatError(error instanceof Error ? error.message : "Failed to send chat message.");
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
                      prefetch={false}
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
        <Link href="/dashboard" prefetch={false} className={pathname === "/dashboard" ? "active" : ""}>Dashboard</Link>
        <Link href="/businesses" prefetch={false} className={pathname === "/businesses" ? "active" : ""}>My Businesses</Link>
        <Link href="/market" prefetch={false} className={pathname === "/market" ? "active" : ""}>Market</Link>
        <Link href="/banking" prefetch={false} className={pathname === "/banking" ? "active" : ""}>Banking</Link>
        <Link href="/contracts" prefetch={false} className={pathname === "/contracts" ? "active" : ""}>Contracts</Link>
        <Link href="/inventory" prefetch={false} className={pathname === "/inventory" ? "active" : ""}>Inventory</Link>
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
                <span>{chatError ?? (isRealtimeConnected ? "Live updates enabled" : "Fallback polling active")}</span>
              </div>
            </div>
          ) : null}
        </div>
        <div className="icon-btn" title="Storefront alerts">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 01-3.46 0"/></svg>
            {(notificationsCount ?? 0) > 0 ? <div className="notif-badge">{notificationsCount}</div> : null}
        </div>
        <div className={`avatar-btn ${identityLoaded ? "" : "avatar-btn-loading"}`.trim()}>
          <div className="avatar-circle">{identity.initials}</div>
          <div className="avatar-info">
            <div className="avatar-name">
              {identityLoaded ? `${identity.firstName} ${identity.lastName}` : "Loading profile"}
            </div>
            <div className="avatar-level">Active operator</div>
          </div>
        </div>
      </div>
    </div>
  );
}
