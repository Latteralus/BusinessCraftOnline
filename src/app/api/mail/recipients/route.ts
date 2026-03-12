import { searchMailRecipients, mailRecipientSearchSchema } from "@/domains/mail";
import { NextResponse } from "next/server";
import { handleAuthedRequest } from "../../_shared/route-helpers";

export async function GET(request: Request) {
  return handleAuthedRequest(
    async ({ supabase, user }) => {
      const url = new URL(request.url);
      const parsed = mailRecipientSearchSchema.safeParse({
        q: url.searchParams.get("q") ?? "",
      });

      if (!parsed.success) {
        return NextResponse.json(
          { error: parsed.error.issues[0]?.message ?? "Invalid recipient search." },
          { status: 400 }
        );
      }

      const recipients = await searchMailRecipients(supabase, parsed.data.q, user.id);
      return NextResponse.json({ recipients });
    },
    {
      errorMessage: "Failed to search mail recipients.",
      errorStatus: 500,
    }
  );
}
