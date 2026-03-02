import { SignJWT, jwtVerify } from "jose";

const getJwtSecret = () => {
  const secret = process.env.SUPABASE_JWT_SECRET;
  if (!secret) {
    throw new Error("SUPABASE_JWT_SECRET is not set in the environment variables.");
  }
  return new TextEncoder().encode(secret);
};

export async function signCustomJwt(playerId: string): Promise<string> {
  const secret = getJwtSecret();
  
  // Create a JWT that PostgREST and Supabase will accept
  const token = await new SignJWT({
    role: "authenticated",
    aud: "authenticated",
    iss: "supabase",
    sub: playerId,
  })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuedAt()
    .setExpirationTime("7d") // Set token to expire in 7 days
    .sign(secret);

  return token;
}

export async function verifyCustomJwt(token: string) {
  try {
    const secret = getJwtSecret();
    const { payload } = await jwtVerify(token, secret);
    return payload;
  } catch (error) {
    return null;
  }
}
