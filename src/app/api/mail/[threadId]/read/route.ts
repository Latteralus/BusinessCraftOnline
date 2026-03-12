import { markMailThreadRead, markMailThreadReadSchema } from "@/domains/mail";
import { NextResponse } from "next/server";
import { handleAuthedJsonRequest } from "../../../_shared/route-helpers";

type Params = {
  params: Promise<{ threadId: string }>;
};

export async function PATCH(request: Request, { params }: Params) {
  const { threadId } = await params;

  return handleAuthedJsonRequest(
    request,
    markMailThreadReadSchema,
    "Invalid mail read payload.",
    async ({ supabase }, data) => {
      await markMailThreadRead(supabase, threadId, data.viewedAt);
      return NextResponse.json({ ok: true });
    },
    {
      errorMessage: "Failed to update mail read state.",
      errorStatus: 400,
    }
  );
}
