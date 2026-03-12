import { getRecentChatMessages, getUnreadChatCount, markChatRead, markChatReadSchema, sendChatMessage, sendChatMessageSchema } from "@/domains/chat";
import { NextResponse } from "next/server";
import { handleAuthedJsonRequest, handleAuthedRequest } from "../_shared/route-helpers";

export async function GET() {
  return handleAuthedRequest(
    async ({ supabase, user }) => {
      const messages = await getRecentChatMessages(supabase, 50);
      const unreadCount = await getUnreadChatCount(supabase, user.id).catch(() => 0);
      return NextResponse.json({ messages, unreadCount });
    },
    {
      errorMessage: "Failed to load chat.",
      errorStatus: 500,
    }
  );
}

export async function POST(request: Request) {
  return handleAuthedJsonRequest(
    request,
    sendChatMessageSchema,
    "Invalid chat message.",
    async ({ supabase }, data) => {
      const message = await sendChatMessage(supabase, data.message);
      return NextResponse.json({ message });
    },
    {
      errorMessage: "Failed to send chat message.",
      errorStatus: 400,
    }
  );
}

export async function PATCH(request: Request) {
  return handleAuthedJsonRequest(
    request,
    markChatReadSchema,
    "Invalid chat read timestamp.",
    async ({ supabase }, data) => {
      await markChatRead(supabase, data.viewedAt);
      return NextResponse.json({ ok: true });
    },
    {
      errorMessage: "Failed to update chat unread state.",
      errorStatus: 400,
    }
  );
}
