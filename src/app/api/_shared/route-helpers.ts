import { createSupabaseServerClient } from "@/lib/supabase-server";
import { NextResponse } from "next/server";
import type { z, ZodTypeAny } from "zod";

export async function requireAuthedUser() {
  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return {
      ok: false as const,
      response: NextResponse.json({ error: "Unauthorized." }, { status: 401 }),
    };
  }

  return {
    ok: true as const,
    supabase,
    user,
  };
}

export async function parseJsonBody<TSchema extends ZodTypeAny>(
  request: Request,
  schema: TSchema,
  invalidMessage: string
): Promise<{ ok: true; data: z.infer<TSchema> } | { ok: false; response: NextResponse }> {
  const payload = await request.json().catch(() => null);
  const parsed = schema.safeParse(payload);

  if (!parsed.success) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? invalidMessage },
        { status: 400 }
      ),
    };
  }

  return { ok: true, data: parsed.data };
}

export function badRequest(message: string) {
  return NextResponse.json({ error: message }, { status: 400 });
}

export function notFound(message: string) {
  return NextResponse.json({ error: message }, { status: 404 });
}

export function fail(error: unknown, fallback: string, status = 400) {
  return NextResponse.json(
    { error: error instanceof Error ? error.message : fallback },
    { status }
  );
}

