import { replyMailSchema, replyToMailThread } from "@/domains/mail";
import { NextResponse } from "next/server";
import { handleAuthedJsonRequest } from "../../../_shared/route-helpers";

type Params = {
  params: Promise<{ threadId: string }>;
};

export async function POST(request: Request, { params }: Params) {
  const { threadId } = await params;

  return handleAuthedJsonRequest(
    request,
    replyMailSchema,
    "Invalid reply payload.",
    async ({ supabase }, data) => {
      await replyToMailThread(supabase, threadId, data.body);
      return NextResponse.json({ ok: true });
    },
    {
      errorMessage: "Failed to send mail reply.",
      errorStatus: 400,
    }
  );
}
