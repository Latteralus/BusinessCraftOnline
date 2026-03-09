import { getRecentChatMessages, sendChatMessage, sendChatMessageSchema } from "@/domains/chat";
import { NextResponse } from "next/server";
import { handleAuthedJsonRequest, handleAuthedRequest } from "../_shared/route-helpers";

export async function GET() {
  return handleAuthedRequest(
    async ({ supabase }) => {
      const messages = await getRecentChatMessages(supabase, 50);
      return NextResponse.json({ messages });
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
