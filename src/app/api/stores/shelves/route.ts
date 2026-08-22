import {
  getStoreShelfItems,
  removeStoreShelfItem,
  removeStoreShelfItemSchema,
  storeShelfItemFilterSchema,
  upsertStoreShelfItem,
  upsertStoreShelfItemSchema,
} from "@/domains/stores";
import { badRequest, handleAuthedJsonRequest, handleAuthedRequest } from "@/app/api/_shared/route-helpers";
import { NextResponse } from "next/server";

export async function GET(request: Request) {
  return handleAuthedRequest(async ({ supabase, user }) => {
    const url = new URL(request.url);
    const parsed = storeShelfItemFilterSchema.safeParse({
      businessId: url.searchParams.get("businessId") ?? undefined,
    });

    if (!parsed.success) {
      return badRequest(parsed.error.issues[0]?.message ?? "Invalid shelf query.");
    }

    const shelfItems = await getStoreShelfItems(supabase, user.id, parsed.data);
    return NextResponse.json({ shelfItems });
  }, { errorMessage: "Failed to load shelf items.", errorStatus: 500 });
}

export async function POST(request: Request) {
  return handleAuthedJsonRequest(
    request,
    upsertStoreShelfItemSchema,
    "Invalid shelf item payload.",
    async ({ supabase, user }, data) => {
      const shelfItem = await upsertStoreShelfItem(supabase, user.id, data);
      return NextResponse.json({ shelfItem });
    },
    { errorMessage: "Failed to save shelf item." }
  );
}

export async function DELETE(request: Request) {
  return handleAuthedJsonRequest(
    request,
    removeStoreShelfItemSchema,
    "Invalid shelf item payload.",
    async ({ supabase, user }, data) => {
      await removeStoreShelfItem(supabase, user.id, data);
      return NextResponse.json({ ok: true });
    },
    { errorMessage: "Failed to remove shelf item." }
  );
}
