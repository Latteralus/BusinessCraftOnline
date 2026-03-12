import type {
  MailMessage,
  MailRecipientPreview,
  MailThreadDetail,
  MailThreadPreview,
  MailboxData,
} from "./types";

type QueryClient = {
  from: (table: string) => any;
  rpc: (fn: string, args?: Record<string, unknown>) => any;
};

type MailThreadRow = {
  id: string;
  kind: "player" | "system";
  subject: string;
  system_key: string | null;
  created_at: string;
  updated_at: string;
};

type MailParticipantRow = {
  thread_id: string;
  player_id: string;
  role: "sender" | "recipient" | "system_recipient";
  last_read_message_created_at: string | null;
  deleted_at: string | null;
};

type MailMessageRow = {
  id: string;
  thread_id: string;
  sender_player_id: string | null;
  sender_type: "player" | "system";
  body: string;
  created_at: string;
};

type CharacterNameRow = {
  player_id: string;
  first_name: string;
  last_name: string;
};

function formatCharacterName(row: CharacterNameRow | undefined | null) {
  if (!row) {
    return "Unknown Player";
  }

  return `${row.first_name} ${row.last_name}`.trim();
}

function mapMessage(
  row: MailMessageRow,
  characterNamesByPlayerId: Map<string, string>
): MailMessage {
  const senderCharacterName =
    row.sender_type === "system"
      ? "System"
      : characterNamesByPlayerId.get(row.sender_player_id ?? "") ?? "Unknown Player";

  return {
    id: row.id,
    threadId: row.thread_id,
    senderPlayerId: row.sender_player_id,
    senderType: row.sender_type,
    senderCharacterName,
    body: row.body,
    createdAt: row.created_at,
  };
}

function buildThreadPreview(
  thread: MailThreadRow,
  currentPlayerId: string,
  participants: MailParticipantRow[],
  latestMessage: MailMessageRow | null,
  characterNamesByPlayerId: Map<string, string>
): MailThreadPreview {
  const currentParticipant = participants.find((participant) => participant.player_id === currentPlayerId) ?? null;
  const counterpartParticipant =
    thread.kind === "system"
      ? null
      : participants.find((participant) => participant.player_id !== currentPlayerId) ?? null;
  const latestMappedMessage = latestMessage ? mapMessage(latestMessage, characterNamesByPlayerId) : null;

  return {
    id: thread.id,
    kind: thread.kind,
    subject: thread.subject,
    systemKey: thread.system_key,
    counterpart:
      thread.kind === "system"
        ? { playerId: null, characterName: "System" }
        : {
            playerId: counterpartParticipant?.player_id ?? null,
            characterName:
              characterNamesByPlayerId.get(counterpartParticipant?.player_id ?? "") ??
              "Unknown Player",
          },
    latestMessage: latestMappedMessage,
    unread:
      latestMessage
        ? !currentParticipant?.last_read_message_created_at ||
          new Date(latestMessage.created_at).getTime() >
            new Date(currentParticipant.last_read_message_created_at).getTime()
        : false,
    createdAt: thread.created_at,
    updatedAt: thread.updated_at,
  };
}

async function getCharacterNames(
  client: QueryClient,
  playerIds: string[]
): Promise<Map<string, string>> {
  const uniquePlayerIds = Array.from(new Set(playerIds.filter(Boolean)));
  if (uniquePlayerIds.length === 0) {
    return new Map();
  }

  const { data, error } = await client
    .from("characters")
    .select("player_id, first_name, last_name")
    .in("player_id", uniquePlayerIds);

  if (error) {
    throw error;
  }

  return new Map(
    ((data as CharacterNameRow[]) ?? []).map((row) => [row.player_id, formatCharacterName(row)])
  );
}

async function getVisibleThreadParticipants(
  client: QueryClient,
  threadIds: string[]
): Promise<MailParticipantRow[]> {
  if (threadIds.length === 0) {
    return [];
  }

  const { data, error } = await client
    .from("mail_thread_participants")
    .select("thread_id, player_id, role, last_read_message_created_at, deleted_at")
    .in("thread_id", threadIds);

  if (error) {
    throw error;
  }

  return (data as MailParticipantRow[]) ?? [];
}

async function getLatestMessagesForThreads(
  client: QueryClient,
  threadIds: string[]
): Promise<Map<string, MailMessageRow>> {
  if (threadIds.length === 0) {
    return new Map();
  }

  const { data, error } = await client
    .from("mail_messages")
    .select("id, thread_id, sender_player_id, sender_type, body, created_at")
    .in("thread_id", threadIds)
    .order("created_at", { ascending: false });

  if (error) {
    throw error;
  }

  const latestByThreadId = new Map<string, MailMessageRow>();
  for (const row of (data as MailMessageRow[]) ?? []) {
    if (!latestByThreadId.has(row.thread_id)) {
      latestByThreadId.set(row.thread_id, row);
    }
  }

  return latestByThreadId;
}

export async function getMailboxData(
  client: QueryClient,
  playerId: string,
  activeThreadId?: string,
  limit = 30
): Promise<MailboxData> {
  const safeLimit = Math.max(1, Math.min(limit, 50));
  const { data: threadsData, error: threadsError } = await client
    .from("mail_threads")
    .select("id, kind, subject, system_key, created_at, updated_at")
    .order("updated_at", { ascending: false })
    .limit(safeLimit);

  if (threadsError) {
    throw threadsError;
  }

  const threads = (threadsData as MailThreadRow[]) ?? [];
  const threadIds = threads.map((thread) => thread.id);
  const [participants, latestMessagesByThreadId] = await Promise.all([
    getVisibleThreadParticipants(client, threadIds),
    getLatestMessagesForThreads(client, threadIds),
  ]);

  const characterNamesByPlayerId = await getCharacterNames(
    client,
    participants.map((participant) => participant.player_id).concat(
      Array.from(latestMessagesByThreadId.values())
        .map((message) => message.sender_player_id ?? "")
        .filter(Boolean)
    )
  );

  const participantsByThreadId = new Map<string, MailParticipantRow[]>();
  for (const participant of participants) {
    const list = participantsByThreadId.get(participant.thread_id) ?? [];
    list.push(participant);
    participantsByThreadId.set(participant.thread_id, list);
  }

  const previews = threads.map((thread) =>
    buildThreadPreview(
      thread,
      playerId,
      participantsByThreadId.get(thread.id) ?? [],
      latestMessagesByThreadId.get(thread.id) ?? null,
      characterNamesByPlayerId
    )
  );

  let activeThread: MailThreadDetail | null = null;
  if (activeThreadId) {
    const preview = previews.find((thread) => thread.id === activeThreadId) ?? null;
    if (preview) {
      const { data: messagesData, error: messagesError } = await client
        .from("mail_messages")
        .select("id, thread_id, sender_player_id, sender_type, body, created_at")
        .eq("thread_id", activeThreadId)
        .order("created_at", { ascending: true })
        .limit(100);

      if (messagesError) {
        throw messagesError;
      }

      activeThread = {
        ...preview,
        messages: ((messagesData as MailMessageRow[]) ?? []).map((message) =>
          mapMessage(message, characterNamesByPlayerId)
        ),
      };
    }
  }

  return {
    threads: previews,
    activeThread,
  };
}

export async function getUnreadMailCount(
  client: QueryClient,
  playerId: string
): Promise<number> {
  const { data, error } = await client
    .from("mail_thread_participants")
    .select("thread_id, last_read_message_created_at")
    .eq("player_id", playerId)
    .is("deleted_at", null);

  if (error) {
    throw error;
  }

  const participants = (data as Array<Pick<MailParticipantRow, "thread_id" | "last_read_message_created_at">>) ?? [];
  if (participants.length === 0) {
    return 0;
  }

  const latestMessagesByThreadId = await getLatestMessagesForThreads(
    client,
    participants.map((participant) => participant.thread_id)
  );

  return participants.filter((participant) => {
    const latest = latestMessagesByThreadId.get(participant.thread_id);
    if (!latest?.created_at) {
      return false;
    }
    if (!participant.last_read_message_created_at) {
      return true;
    }
    return new Date(latest.created_at).getTime() > new Date(participant.last_read_message_created_at).getTime();
  }).length;
}

export async function createPlayerMail(
  client: QueryClient,
  input: { recipientPlayerId: string; subject: string; body: string }
): Promise<string> {
  const { data, error } = await client.rpc("create_player_mail", {
    p_recipient_player_id: input.recipientPlayerId,
    p_subject: input.subject,
    p_body: input.body,
  });

  if (error) {
    throw error;
  }

  return String(data);
}

export async function replyToMailThread(
  client: QueryClient,
  threadId: string,
  body: string
): Promise<void> {
  const { error } = await client.rpc("reply_to_mail_thread", {
    p_thread_id: threadId,
    p_body: body,
  });

  if (error) {
    throw error;
  }
}

export async function markMailThreadRead(
  client: QueryClient,
  threadId: string,
  viewedAt?: string
): Promise<void> {
  const { error } = await client.rpc("mark_mail_thread_read", {
    p_thread_id: threadId,
    p_last_read_message_created_at: viewedAt ?? null,
  });

  if (error) {
    throw error;
  }
}

export async function deleteMailThreadForPlayer(
  client: QueryClient,
  threadId: string
): Promise<void> {
  const { error } = await client.rpc("delete_mail_thread_for_player", {
    p_thread_id: threadId,
  });

  if (error) {
    throw error;
  }
}

export async function sendSystemMail(
  client: QueryClient,
  input: { recipientPlayerId: string; subject: string; body: string; systemKey?: string | null }
): Promise<string> {
  const { data, error } = await client.rpc("send_system_mail", {
    p_recipient_player_id: input.recipientPlayerId,
    p_subject: input.subject,
    p_body: input.body,
    p_system_key: input.systemKey ?? null,
  });

  if (error) {
    throw error;
  }

  return String(data);
}

export async function searchMailRecipients(
  client: QueryClient,
  query: string,
  excludePlayerId?: string
): Promise<MailRecipientPreview[]> {
  let request = client
    .from("characters")
    .select("player_id, first_name, last_name")
    .or(`first_name.ilike.%${query}%,last_name.ilike.%${query}%`)
    .limit(10);

  if (excludePlayerId) {
    request = request.neq("player_id", excludePlayerId);
  }

  const { data, error } = await request;
  if (error) {
    throw error;
  }

  return ((data as CharacterNameRow[]) ?? []).map((row) => ({
    playerId: row.player_id,
    characterName: formatCharacterName(row),
  }));
}
