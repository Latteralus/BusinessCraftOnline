// Vitest setupFile: points every `src/lib/env.ts` / `src/lib/auth-jwt.ts`
// getter at the local Supabase stack *before* any test file's module graph
// runs, so accidentally importing a domain/service file never falls back to
// `.env.local` (which points at the hosted project).
import {
  LOCAL_SUPABASE_ANON_KEY,
  LOCAL_SUPABASE_JWT_SECRET,
  LOCAL_SUPABASE_SERVICE_ROLE_KEY,
  LOCAL_SUPABASE_URL,
} from "./env";

process.env.NEXT_PUBLIC_SUPABASE_URL = LOCAL_SUPABASE_URL;
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = LOCAL_SUPABASE_ANON_KEY;
process.env.SUPABASE_SERVICE_ROLE_KEY = LOCAL_SUPABASE_SERVICE_ROLE_KEY;
process.env.SUPABASE_JWT_SECRET = LOCAL_SUPABASE_JWT_SECRET;
