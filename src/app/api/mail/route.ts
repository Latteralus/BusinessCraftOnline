import {
  createPlayerMail,
  getMailboxData,
  mailboxQuerySchema,
  sendMailSchema,
} from "@/domains/mail";
import { NextResponse } from "next/server";
import { handleAuthedJsonRequest, handleAuthedRequest } from "../_shared/route-helpers";

export async function GET(request: Request) {
  return handleAuthedRequest(
    async ({ supabase, user }) => {
      const url = new URL(request.url);
      const parsed = mailboxQuerySchema.safeParse({
        threadId: url.searchParams.get("threadId") ?? undefined,
      });

      if (!parsed.success) {
        return NextResponse.json(
          { error: parsed.error.issues[0]?.message ?? "Invalid mail query." },
          { status: 400 }
        );
      }

      const mailbox = await getMailboxData(supabase, user.id, parsed.data.threadId);
      return NextResponse.json(mailbox);
    },
    {
      errorMessage: "Failed to load mail.",
      errorStatus: 500,
    }
  );
}

export async function POST(request: Request) {
  return handleAuthedJsonRequest(
    request,
    sendMailSchema,
    "Invalid mail payload.",
    async ({ supabase }, data) => {
      const threadId = await createPlayerMail(supabase, data);
      return NextResponse.json({ threadId }, { status: 201 });
    },
    {
      errorMessage: "Failed to send mail.",
      errorStatus: 400,
    }
  );
}
