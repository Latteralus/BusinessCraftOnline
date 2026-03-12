import type { ChatMessage } from "./types";

type QueryClient = {
  from: (table: string) => any;
  rpc: (fn: string, args?: Record<string, unknown>) => any;
};

export async function getRecentChatMessages(
  client: QueryClient,
  limit = 50
): Promise<ChatMessage[]> {
  const safeLimit = Math.max(1, Math.min(limit, 100));
  const { data, error } = await client
    .from("chat_messages")
    .select("id, player_id, character_first_name, message, created_at")
    .order("created_at", { ascending: false })
    .limit(safeLimit);

  if (error) throw error;

  return ((data as ChatMessage[]) ?? []).slice().reverse();
}

export async function sendChatMessage(
  client: QueryClient,
  message: string
): Promise<ChatMessage> {
  const { data, error } = await client.rpc("send_chat_message", {
    p_message: message,
  });

  if (error) throw error;
  return data as ChatMessage;
}

export async function getUnreadChatCount(
  client: QueryClient,
  playerId: string
): Promise<number> {
  const { data: state, error: stateError } = await client
    .from("player_chat_state")
    .select("last_read_message_created_at")
    .eq("player_id", playerId)
    .maybeSingle();

  if (stateError) {
    throw stateError;
  }

  let query = client
    .from("chat_messages")
    .select("id", { count: "exact", head: true })
    .neq("player_id", playerId);

  if (state?.last_read_message_created_at) {
    query = query.gt("created_at", state.last_read_message_created_at);
  }

  const { count, error } = await query;
  if (error) {
    throw error;
  }

  return count ?? 0;
}

export async function markChatRead(
  client: QueryClient,
  viewedAt: string
): Promise<void> {
  const { error } = await client.rpc("mark_chat_read", {
    p_last_read_message_created_at: viewedAt,
  });

  if (error) {
    throw error;
  }
}
