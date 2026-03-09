import {
  deleteBusiness,
  getBusinessDetail,
  renameBusiness,
  renameBusinessSchema,
} from "@/domains/businesses";
import {
  fail,
  handleAuthedJsonRequest,
  handleAuthedRequest,
  notFound,
} from "@/app/api/_shared/route-helpers";
import { NextResponse } from "next/server";

type Params = {
  params: Promise<{ id: string }>;
};

export async function GET(_request: Request, { params }: Params) {
  const { id } = await params;
  return handleAuthedRequest(async ({ supabase, user }) => {
    const business = await getBusinessDetail(supabase, user.id, id);

    if (!business) {
      return notFound("Business not found.");
    }

    return NextResponse.json({ business });
  }, { errorMessage: "Failed to fetch business.", errorStatus: 500 });
}

export async function PATCH(request: Request, { params }: Params) {
  const { id } = await params;

  return handleAuthedJsonRequest(
    request,
    renameBusinessSchema,
    "Invalid business rename payload.",
    async ({ supabase, user }, data) => {
      const business = await renameBusiness(supabase, user.id, id, data);
      return NextResponse.json({ business });
    },
    { errorMessage: "Failed to rename business." }
  );
}

export async function DELETE(_request: Request, { params }: Params) {
  const { id } = await params;

  return handleAuthedRequest(async ({ supabase, user }) => {
    try {
      await deleteBusiness(supabase, user.id, id);
    } catch (error) {
      if (error instanceof Error && error.message === "Business not found.") {
        return notFound("Business not found.");
      }
      return fail(error, "Failed to delete business.");
    }

    return NextResponse.json({ success: true });
  }, { errorMessage: "Failed to delete business." });
}
