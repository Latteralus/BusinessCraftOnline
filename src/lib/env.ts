// Single source of truth for reading required environment variables.
// Every call site used to do `process.env.NEXT_PUBLIC_SUPABASE_URL ?? ""`
// independently, so a missing var silently became an empty string and only
// surfaced later as an opaque `createClient("")` failure. These getters
// throw a clear, named error at first access instead.
//
// Deliberately has no "next/headers" import and no dynamic `process.env[name]`
// lookups:
// - supabase-service-role.ts depends on staying free of "next/headers" (see
//   that file's own comment) because it's on an import path client
//   components also pull in; this module sits upstream of it.
// - Next.js only statically inlines `NEXT_PUBLIC_*` vars into the browser
//   bundle when they appear as a literal `process.env.NEXT_PUBLIC_X` dot
//   access. A generic `process.env[name]` helper would defeat that
//   replacement and silently resolve to `undefined` in the browser, so each
//   var gets its own getter with a literal reference instead.

function required(value: string | undefined, name: string): string {
  if (!value) {
    throw new Error(`${name} is not set in the environment variables.`);
  }
  return value;
}

export function getSupabaseUrl(): string {
  return required(process.env.NEXT_PUBLIC_SUPABASE_URL, "NEXT_PUBLIC_SUPABASE_URL");
}

export function getSupabaseAnonKey(): string {
  return required(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, "NEXT_PUBLIC_SUPABASE_ANON_KEY");
}

export function getSupabaseServiceRoleKey(): string {
  return required(process.env.SUPABASE_SERVICE_ROLE_KEY, "SUPABASE_SERVICE_ROLE_KEY");
}
