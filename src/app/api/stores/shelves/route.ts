import {
  getStoreShelfItems,
  removeStoreShelfItem,
  removeStoreShelfItemSchema,
  storeShelfItemFilterSchema,
  upsertStoreShelfItem,
  upsertStoreShelfItemSchema,
} from "@/domains/stores";
import { badRequest, fail, parseJsonBody, requireAuthedUser } from "@/app/api/_shared/route-helpers";
import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const auth = await requireAuthedUser();
  if (!auth.ok) return auth.response;
  const { supabase, user } = auth;

  const url = new URL(request.url);
  const parsed = storeShelfItemFilterSchema.safeParse({
    businessId: url.searchParams.get("businessId") ?? undefined,
  });

  if (!parsed.success) {
    return badRequest(parsed.error.issues[0]?.message ?? "Invalid shelf query.");
  }

  try {
    const shelfItems = await getStoreShelfItems(supabase, user.id, parsed.data);
    return NextResponse.json({ shelfItems });
  } catch (error) {
    return fail(error, "Failed to load shelf items.", 500);
  }
}

export async function POST(request: Request) {
  const auth = await requireAuthedUser();
  if (!auth.ok) return auth.response;
  const { supabase, user } = auth;

  const parsed = await parseJsonBody(request, upsertStoreShelfItemSchema, "Invalid shelf item payload.");
  if (!parsed.ok) return parsed.response;

  try {
    const shelfItem = await upsertStoreShelfItem(supabase, user.id, parsed.data);
    return NextResponse.json({ shelfItem });
  } catch (error) {
    return fail(error, "Failed to save shelf item.");
  }
}

export async function DELETE(request: Request) {
  const auth = await requireAuthedUser();
  if (!auth.ok) return auth.response;
  const { supabase, user } = auth;

  const parsed = await parseJsonBody(request, removeStoreShelfItemSchema, "Invalid shelf item payload.");
  if (!parsed.ok) return parsed.response;

  try {
    await removeStoreShelfItem(supabase, user.id, parsed.data);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return fail(error, "Failed to remove shelf item.");
  }
}
