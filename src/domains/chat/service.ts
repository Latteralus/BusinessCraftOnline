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
