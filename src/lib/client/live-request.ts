type ApiMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export const LIVE_QUERY_CACHE_POLICY: RequestCache = "no-store";

export function resolveLiveRequestCache(
  method: ApiMethod,
  explicitCache?: RequestCache
): RequestCache | undefined {
  return method === "GET" ? LIVE_QUERY_CACHE_POLICY : explicitCache;
}
