import { SignJWT, jwtVerify } from "jose";
import { CUSTOM_SESSION_TTL_SECONDS } from "./session";

const getJwtSecret = () => {
  const secret = process.env.SUPABASE_JWT_SECRET;
  if (!secret) {
    throw new Error("SUPABASE_JWT_SECRET is not set in the environment variables.");
  }
  return new TextEncoder().encode(secret);
};

export async function signCustomJwt(playerId: string, appRole: "player" | "admin" = "player"): Promise<string> {
  const secret = getJwtSecret();

  // `role` is PostgREST's own claim -- it picks the Postgres role used for
  // RLS (authenticated/anon/service_role) and must stay "authenticated".
  // The player's app-level role (player/admin) is a separate claim,
  // `app_role`, so requireAdminUser can check it without a DB round trip on
  // every admin request. See changelog 2026-08-17 (M6): a role change only
  // takes effect on the next login, since the token isn't revoked early.
  const token = await new SignJWT({
    role: "authenticated",
    aud: "authenticated",
    iss: "supabase",
    sub: playerId,
    app_role: appRole,
  })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuedAt()
    .setExpirationTime(`${CUSTOM_SESSION_TTL_SECONDS}s`)
    .sign(secret);

  return token;
}

export async function verifyCustomJwt(token: string) {
  try {
    const secret = getJwtSecret();
    const { payload } = await jwtVerify(token, secret);
    return payload;
  } catch (error) {
    console.error("[verifyCustomJwt] verification failed:", error);
    return null;
  }
}
