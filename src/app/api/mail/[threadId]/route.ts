import { deleteMailThreadForPlayer } from "@/domains/mail";
import { NextResponse } from "next/server";
import { handleAuthedRequest } from "../../_shared/route-helpers";

type Params = {
  params: Promise<{ threadId: string }>;
};

export async function DELETE(_request: Request, { params }: Params) {
  const { threadId } = await params;

  return handleAuthedRequest(
    async ({ supabase }) => {
      await deleteMailThreadForPlayer(supabase, threadId);
      return NextResponse.json({ ok: true });
    },
    {
      errorMessage: "Failed to delete mail thread.",
      errorStatus: 400,
    }
  );
}
