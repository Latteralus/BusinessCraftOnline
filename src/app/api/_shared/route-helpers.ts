import { createSupabaseServerClient } from "@/lib/supabase-server";
import { NextResponse } from "next/server";
import type { z, ZodTypeAny } from "zod";

type AuthedUserResult = Awaited<ReturnType<typeof requireAuthedUser>>;
type AuthedContext = Extract<AuthedUserResult, { ok: true }>;

export async function requireAuthedUser() {
  const supabase = await createSupabaseServerClient();
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
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "object" && error !== null && "message" in error && typeof error.message === "string"
        ? error.message
        : fallback;

  return NextResponse.json(
    { error: message },
    { status }
  );
}

export async function handleAuthedRequest(
  handler: (context: AuthedContext) => Promise<Response>,
  options?: {
    errorMessage?: string;
    errorStatus?: number;
  }
) {
  const auth = await requireAuthedUser();
  if (!auth.ok) return auth.response;

  try {
    return await handler(auth);
  } catch (error) {
    if (!options?.errorMessage) {
      throw error;
    }

    return fail(error, options.errorMessage, options.errorStatus);
  }
}

export async function handleAuthedJsonRequest<TSchema extends ZodTypeAny>(
  request: Request,
  schema: TSchema,
  invalidMessage: string,
  handler: (
    context: AuthedContext,
    data: z.infer<TSchema>
  ) => Promise<Response>,
  options?: {
    errorMessage?: string;
    errorStatus?: number;
  }
) {
  return handleAuthedRequest(async (context) => {
    const parsed = await parseJsonBody(request, schema, invalidMessage);
    if (!parsed.ok) {
      return parsed.response;
    }

    return handler(context, parsed.data);
  }, options);
}
