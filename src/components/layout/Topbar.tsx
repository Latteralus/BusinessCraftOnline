"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import type { OnlinePlayerPreview } from "@/domains/auth-character";
import type { ChatMessage } from "@/domains/chat";
import type { MailRecipientPreview, MailThreadPreview } from "@/domains/mail";
import { apiDelete, apiPatch, apiPost } from "@/lib/client/api";
import { fetchAppShell, fetchChatMessages, fetchMailbox, searchMailRecipients } from "@/lib/client/queries";
import { apiRoutes } from "@/lib/client/routes";
import { formatCurrency } from "@/lib/formatters";
import { runOptimisticUpdate } from "@/stores/optimistic";
import { useAppShellSlice, useChatSlice, useGameStore, useMailSlice, usePlayerSlice } from "@/stores/game-store";

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

function formatMailTimestamp(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "--";
  }

  const now = new Date();
  const isSameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();

  return isSameDay
    ? date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : date.toLocaleDateString([], { month: "short", day: "numeric" });
}

function compareTimestamps(left: string | null, right: string | null) {
  const leftTime = left ? new Date(left).getTime() : Number.NEGATIVE_INFINITY;
  const rightTime = right ? new Date(right).getTime() : Number.NEGATIVE_INFINITY;
  return leftTime - rightTime;
}

export function Topbar() {
  const pathname = usePathname();
  const identity = usePlayerSlice();
  const appShell = useAppShellSlice();
  const chatMessages = useChatSlice();
  const mail = useMailSlice();
  const patchChat = useGameStore((state) => state.patchChat);
  const setChat = useGameStore((state) => state.setChat);
  const removeChatMessage = useGameStore((state) => state.removeChatMessage);
  const setMail = useGameStore((state) => state.setMail);
  const setMailRecipientSearchResults = useGameStore((state) => state.setMailRecipientSearchResults);
  const patchAppShell = useGameStore((state) => state.patchAppShell);
  const [chatInput, setChatInput] = useState("");
  const [chatError, setChatError] = useState<string | null>(null);
  const [mailError, setMailError] = useState<string | null>(null);
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [isMailOpen, setIsMailOpen] = useState(false);
  const [isChatLoading, setIsChatLoading] = useState(true);
  const [isMailLoading, setIsMailLoading] = useState(false);
  const [isSendingChat, setIsSendingChat] = useState(false);
  const [isSendingMail, setIsSendingMail] = useState(false);
  const [isSendingReply, setIsSendingReply] = useState(false);
  const [isDeletingMail, setIsDeletingMail] = useState(false);
  const [isOnlineListOpen, setIsOnlineListOpen] = useState(false);
  const [isComposeMailOpen, setIsComposeMailOpen] = useState(false);
  const [recipientQuery, setRecipientQuery] = useState("");
  const [selectedRecipient, setSelectedRecipient] = useState<MailRecipientPreview | null>(null);
  const [mailSubject, setMailSubject] = useState("");
  const [mailBody, setMailBody] = useState("");
  const [mailReplyBody, setMailReplyBody] = useState("");
  const [isSearchingRecipients, setIsSearchingRecipients] = useState(false);
  const onlineListRef = useRef<HTMLDivElement | null>(null);
  const chatRef = useRef<HTMLDivElement | null>(null);
  const mailRef = useRef<HTMLDivElement | null>(null);
  const chatScrollRef = useRef<HTMLDivElement | null>(null);
  const mailMessagesRef = useRef<HTMLDivElement | null>(null);
  const isChatOpenRef = useRef(false);
  const openMailReadKeyRef = useRef<string | null>(null);
  const hasLoadedInitialChatRef = useRef(false);
  const latestTrackedChatAtRef = useRef<string | null>(null);
  const markReadRequestRef = useRef<string | null>(null);
  const playerCount = appShell.playerCount;
  const onlinePlayers = appShell.onlinePlayers as OnlinePlayerPreview[];
  const notificationsCount = appShell.notificationsCount;
  const chatUnreadCount = appShell.unreadChatCount ?? 0;
  const mailUnreadCount = appShell.unreadMailCount ?? 0;
  const isRealtimeConnected = appShell.connectionStatus === "connected";
  const identityLoaded = Boolean(identity.playerId && identity.firstName && identity.lastName);
  const activeMailThread = mail.activeThread;

  function getLatestChatTimestamp(messages: ChatMessage[]) {
    return messages[messages.length - 1]?.created_at ?? null;
  }

  function setMailboxData(
    data: {
      threads: typeof mail.threads;
      activeThread: typeof mail.activeThread;
    }
  ) {
    setMail({
      threads: data.threads,
      activeThread: data.activeThread,
      recipientSearchResults: useGameStore.getState().mail.data.recipientSearchResults,
    });
  }

  async function refreshShellUnreadMailCount() {
    const shell = await fetchAppShell().catch(() => null);
    if (shell) {
      patchAppShell({ unreadMailCount: shell.unreadMailCount });
    }
  }

  async function refreshMailbox(threadId?: string) {
    setIsMailLoading(true);

    try {
      const data = await fetchMailbox(threadId);
      setMailboxData(data);
      setMailError(null);
      return data;
    } catch (error) {
      setMailError(error instanceof Error ? error.message : "Failed to load mail.");
      return null;
    } finally {
      setIsMailLoading(false);
    }
  }

  function patchUnreadChatCount(nextCount: number) {
    patchAppShell({ unreadChatCount: Math.max(0, nextCount) });
  }

  function markChatViewed(timestamp: string | null) {
    if (!timestamp || markReadRequestRef.current === timestamp) {
      return;
    }

    markReadRequestRef.current = timestamp;
    patchUnreadChatCount(0);

    void apiPatch<{ ok?: boolean; error?: string }>(
      "/api/chat",
      { viewedAt: timestamp },
      { fallbackError: "Failed to update chat unread state." }
    ).catch(() => {
      markReadRequestRef.current = null;
    });
  }

  useEffect(() => {
    let cancelled = false;
    setIsChatLoading(true);

    void fetchChatMessages()
      .then((data) => {
        if (cancelled) {
          return;
        }
        setChat(data.messages ?? []);
        patchUnreadChatCount(data.unreadCount ?? useGameStore.getState().appShell.data.unreadChatCount);
        setChatError(null);
        hasLoadedInitialChatRef.current = true;
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
  }, [setChat, patchAppShell]);

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
    const latestChatAt = getLatestChatTimestamp(chatMessages);
    if (chatMessages.length === 0 || !latestChatAt) {
      return;
    }

    setIsChatLoading(false);

    const previousLatestChatAt = latestTrackedChatAtRef.current;
    latestTrackedChatAtRef.current = latestChatAt;

    if (!hasLoadedInitialChatRef.current || !previousLatestChatAt) {
      hasLoadedInitialChatRef.current = true;
      return;
    }

    const newMessages = chatMessages.filter(
      (message) =>
        message.player_id !== identity.playerId &&
        compareTimestamps(message.created_at, previousLatestChatAt) > 0
    );

    if (newMessages.length === 0) {
      return;
    }

    if (isChatOpenRef.current) {
      markChatViewed(latestChatAt);
      return;
    }

    const currentUnreadCount = useGameStore.getState().appShell.data.unreadChatCount ?? 0;
    patchUnreadChatCount(currentUnreadCount + newMessages.length);
  }, [chatMessages, identity.playerId, patchAppShell]);

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
    if (!isMailOpen) {
      return;
    }

    void refreshMailbox(activeMailThread?.id ?? undefined);
  }, [isMailOpen]);

  useEffect(() => {
    if (!activeMailThread || !isMailOpen) {
      return;
    }

    mailMessagesRef.current?.scrollTo({
      top: mailMessagesRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [activeMailThread, isMailOpen]);

  useEffect(() => {
    if (!isMailOpen || !activeMailThread?.unread || !activeMailThread.latestMessage?.createdAt) {
      return;
    }

    const readKey = `${activeMailThread.id}:${activeMailThread.latestMessage.createdAt}`;
    if (openMailReadKeyRef.current === readKey) {
      return;
    }

    openMailReadKeyRef.current = readKey;

    void apiPatch<{ ok?: boolean; error?: string }>(
      apiRoutes.mail.read(activeMailThread.id),
      { viewedAt: activeMailThread.latestMessage.createdAt },
      { fallbackError: "Failed to mark mail as read." }
    )
      .then(async () => {
        await Promise.all([
          refreshMailbox(activeMailThread.id),
          refreshShellUnreadMailCount(),
        ]);
      })
      .catch((error) => {
        setMailError(error instanceof Error ? error.message : "Failed to mark mail as read.");
      });
  }, [isMailOpen, activeMailThread]);

  useEffect(() => {
    if (!isMailOpen || !isComposeMailOpen) {
      return;
    }

    const query = recipientQuery.trim();
    if (!query || (selectedRecipient && selectedRecipient.characterName === query)) {
      setMailRecipientSearchResults([]);
      setIsSearchingRecipients(false);
      return;
    }

    let cancelled = false;
    const timeout = window.setTimeout(() => {
      setIsSearchingRecipients(true);
      void searchMailRecipients(query)
        .then((results) => {
          if (!cancelled) {
            setMailRecipientSearchResults(results);
            setMailError(null);
          }
        })
        .catch((error) => {
          if (!cancelled) {
            setMailError(error instanceof Error ? error.message : "Failed to search recipients.");
          }
        })
        .finally(() => {
          if (!cancelled) {
            setIsSearchingRecipients(false);
          }
        });
    }, 200);

    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
    };
  }, [isMailOpen, isComposeMailOpen, recipientQuery, selectedRecipient, setMailRecipientSearchResults]);

  useEffect(() => {
    function handleOutsideClick(event: MouseEvent) {
      if (!onlineListRef.current?.contains(event.target as Node)) {
        setIsOnlineListOpen(false);
      }
      if (!chatRef.current?.contains(event.target as Node)) {
        setIsChatOpen(false);
      }
      if (!mailRef.current?.contains(event.target as Node)) {
        setIsMailOpen(false);
      }
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsOnlineListOpen(false);
        setIsChatOpen(false);
        setIsMailOpen(false);
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
        return () => {
          removeChatMessage(optimisticMessage.id);
        };
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

  async function handleSelectMailThread(thread: MailThreadPreview) {
    setIsComposeMailOpen(false);
    setMailError(null);

    try {
      if (thread.unread && thread.latestMessage?.createdAt) {
        await apiPatch<{ ok?: boolean; error?: string }>(
          apiRoutes.mail.read(thread.id),
          { viewedAt: thread.latestMessage.createdAt },
          { fallbackError: "Failed to mark mail as read." }
        );
      }

      await Promise.all([
        refreshMailbox(thread.id),
        refreshShellUnreadMailCount(),
      ]);
    } catch (error) {
      setMailError(error instanceof Error ? error.message : "Failed to open mail thread.");
    }
  }

  async function handleSendMail(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const subject = mailSubject.trim();
    const body = mailBody.trim();

    if (!selectedRecipient) {
      setMailError("Select a recipient before sending mail.");
      return;
    }

    if (!subject || !body || isSendingMail) {
      return;
    }

    setIsSendingMail(true);
    setMailError(null);

    try {
      const payload = await apiPost<{ threadId?: string; error?: string }>(
        apiRoutes.mail.root,
        {
          recipientPlayerId: selectedRecipient.playerId,
          subject,
          body,
        },
        { fallbackError: "Failed to send mail." }
      );

      setMailSubject("");
      setMailBody("");
      setRecipientQuery("");
      setSelectedRecipient(null);
      setMailRecipientSearchResults([]);
      setIsComposeMailOpen(false);
      await refreshMailbox(payload.threadId);
    } catch (error) {
      setMailError(error instanceof Error ? error.message : "Failed to send mail.");
    } finally {
      setIsSendingMail(false);
    }
  }

  async function handleSendReply(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!activeMailThread || activeMailThread.kind !== "player" || isSendingReply) {
      return;
    }

    const body = mailReplyBody.trim();
    if (!body) {
      return;
    }

    setIsSendingReply(true);
    setMailError(null);

    try {
      await apiPost<{ ok?: boolean; error?: string }>(
        apiRoutes.mail.reply(activeMailThread.id),
        { body },
        { fallbackError: "Failed to send mail reply." }
      );
      setMailReplyBody("");
      await refreshMailbox(activeMailThread.id);
    } catch (error) {
      setMailError(error instanceof Error ? error.message : "Failed to send mail reply.");
    } finally {
      setIsSendingReply(false);
    }
  }

  async function handleDeleteMailThread() {
    if (!activeMailThread || isDeletingMail) {
      return;
    }

    setIsDeletingMail(true);
    setMailError(null);

    try {
      await apiDelete<{ ok?: boolean; error?: string }>(
        apiRoutes.mail.delete(activeMailThread.id),
        undefined,
        { fallbackError: "Failed to delete mail thread." }
      );
      setMailReplyBody("");
      await Promise.all([
        refreshMailbox(),
        refreshShellUnreadMailCount(),
      ]);
    } catch (error) {
      setMailError(error instanceof Error ? error.message : "Failed to delete mail thread.");
    } finally {
      setIsDeletingMail(false);
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
              setIsMailOpen(false);
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
        <div className="topbar-mail-wrap" ref={mailRef}>
          <button
            type="button"
            className={`icon-btn ${isMailOpen ? "is-open" : ""}`}
            title="Mail"
            aria-haspopup="dialog"
            aria-expanded={isMailOpen}
            onClick={() => {
              setIsMailOpen((value) => !value);
              setIsChatOpen(false);
              setIsOnlineListOpen(false);
            }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M4 6h16v12H4z"/>
              <path d="m4 7 8 6 8-6"/>
            </svg>
            {mailUnreadCount > 0 ? <div className="notif-badge">{Math.min(mailUnreadCount, 99)}</div> : null}
          </button>
          {isMailOpen ? (
            <div className="mail-popover" role="dialog" aria-label="Mail inbox">
              <div className="mail-header">
                <div>Mail</div>
                <button
                  type="button"
                  className="mail-compose-btn"
                  onClick={() => {
                    setIsComposeMailOpen((value) => !value);
                    setMailError(null);
                    if (isComposeMailOpen) {
                      setMailRecipientSearchResults([]);
                    }
                  }}
                >
                  {isComposeMailOpen ? "Close" : "Compose"}
                </button>
              </div>
              <div className="mail-layout">
                <div className="mail-thread-list">
                  {isMailLoading && mail.threads.length === 0 ? <div className="mail-empty">Loading mail...</div> : null}
                  {!isMailLoading && mail.threads.length === 0 ? (
                    <div className="mail-empty">No mail yet.</div>
                  ) : null}
                  {mail.threads.map((thread) => (
                    <button
                      type="button"
                      key={thread.id}
                      className={`mail-thread-preview ${activeMailThread?.id === thread.id ? "is-active" : ""}`}
                      onClick={() => void handleSelectMailThread(thread)}
                    >
                      <div className="mail-thread-top">
                        <span className="mail-thread-subject">{thread.subject}</span>
                        <span className="mail-thread-time">{formatMailTimestamp(thread.latestMessage?.createdAt ?? thread.updatedAt)}</span>
                      </div>
                      <div className="mail-thread-meta">
                        <span>{thread.counterpart.characterName}</span>
                        {thread.unread ? <span className="mail-thread-unread">Unread</span> : null}
                      </div>
                      <div className="mail-thread-snippet">
                        {thread.latestMessage?.body ?? "No messages yet."}
                      </div>
                    </button>
                  ))}
                </div>
                <div className="mail-detail-panel">
                  {isComposeMailOpen ? (
                    <form className="mail-compose-form" onSubmit={handleSendMail}>
                      <div className="mail-compose-label">To</div>
                      <input
                        className="mail-input"
                        type="text"
                        value={recipientQuery}
                        onChange={(event) => {
                          setRecipientQuery(event.target.value);
                          setSelectedRecipient(null);
                        }}
                        placeholder="Search character name"
                        maxLength={64}
                      />
                      {isSearchingRecipients ? <div className="mail-search-state">Searching...</div> : null}
                      {!isSearchingRecipients && mail.recipientSearchResults.length > 0 ? (
                        <div className="mail-recipient-results">
                          {mail.recipientSearchResults.map((recipient) => (
                            <button
                              type="button"
                              key={recipient.playerId}
                              className="mail-recipient-option"
                              onClick={() => {
                                setSelectedRecipient(recipient);
                                setRecipientQuery(recipient.characterName);
                                setMailRecipientSearchResults([]);
                              }}
                            >
                              {recipient.characterName}
                            </button>
                          ))}
                        </div>
                      ) : null}
                      {selectedRecipient ? (
                        <div className="mail-selected-recipient">Sending to {selectedRecipient.characterName}</div>
                      ) : null}
                      <div className="mail-compose-label">Subject</div>
                      <input
                        className="mail-input"
                        type="text"
                        value={mailSubject}
                        onChange={(event) => setMailSubject(event.target.value)}
                        placeholder="Subject"
                        maxLength={120}
                      />
                      <div className="mail-compose-label">Message</div>
                      <textarea
                        className="mail-textarea"
                        value={mailBody}
                        onChange={(event) => setMailBody(event.target.value)}
                        placeholder="Write your message"
                        maxLength={4000}
                        rows={7}
                      />
                      <button
                        className="mail-action-btn"
                        type="submit"
                        disabled={!selectedRecipient || isSendingMail || mailSubject.trim().length === 0 || mailBody.trim().length === 0}
                      >
                        {isSendingMail ? "Sending..." : "Send Mail"}
                      </button>
                    </form>
                  ) : activeMailThread ? (
                    <>
                      <div className="mail-thread-detail-header">
                        <div>
                          <div className="mail-thread-detail-subject">{activeMailThread.subject}</div>
                          <div className="mail-thread-detail-meta">{activeMailThread.counterpart.characterName}</div>
                        </div>
                        <button
                          type="button"
                          className="mail-delete-btn"
                          onClick={() => void handleDeleteMailThread()}
                          disabled={isDeletingMail}
                        >
                          {isDeletingMail ? "Deleting..." : "Delete"}
                        </button>
                      </div>
                      <div className="mail-message-list" ref={mailMessagesRef}>
                        {activeMailThread.messages.map((message) => (
                          <div className="mail-message-row" key={message.id}>
                            <div className="mail-message-meta">
                              <span className="mail-message-sender">{message.senderCharacterName}</span>
                              <span className="mail-message-time">{formatMailTimestamp(message.createdAt)}</span>
                            </div>
                            <div className="mail-message-body">{message.body}</div>
                          </div>
                        ))}
                      </div>
                      {activeMailThread.kind === "player" ? (
                        <form className="mail-reply-form" onSubmit={handleSendReply}>
                          <textarea
                            className="mail-textarea"
                            value={mailReplyBody}
                            onChange={(event) => setMailReplyBody(event.target.value)}
                            placeholder="Write a reply"
                            maxLength={4000}
                            rows={4}
                          />
                          <button
                            className="mail-action-btn"
                            type="submit"
                            disabled={isSendingReply || mailReplyBody.trim().length === 0}
                          >
                            {isSendingReply ? "Sending..." : "Reply"}
                          </button>
                        </form>
                      ) : (
                        <div className="mail-system-note">System mail cannot be replied to.</div>
                      )}
                    </>
                  ) : (
                    <div className="mail-empty-detail">Select a mail thread or compose a new message.</div>
                  )}
                </div>
              </div>
              <div className="mail-footer">
                <span>{mailUnreadCount} unread</span>
                <span>{mailError ?? (isRealtimeConnected ? "Live updates enabled" : "Fallback polling active")}</span>
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
