import { resolveLiveRequestCache } from "./live-request";

type ApiErrorPayload = {
  error?: string;
  message?: string;
};

type ApiRequestOptions = Omit<RequestInit, "body" | "headers" | "method"> & {
  body?: unknown;
  headers?: HeadersInit;
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  fallbackError?: string;
};

async function parseResponseBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

function getErrorMessage(payload: unknown) {
  if (!payload || typeof payload !== "object") return null;

  const maybeError = payload as ApiErrorPayload;
  return maybeError.error ?? maybeError.message ?? null;
}

export async function apiRequest<TResponse>(path: string, options: ApiRequestOptions = {}): Promise<TResponse> {
  const { body, fallbackError = "Request failed.", headers: initHeaders, method = "GET", ...rest } = options;
  const headers = new Headers(initHeaders);

  if (body !== undefined && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(path, {
    ...rest,
    cache: resolveLiveRequestCache(method, rest.cache),
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const payload = await parseResponseBody(response);
  if (!response.ok) {
    throw new Error(getErrorMessage(payload) ?? fallbackError);
  }

  return payload as TResponse;
}

export function apiGet<TResponse>(path: string, options: Omit<ApiRequestOptions, "body" | "method"> = {}) {
  return apiRequest<TResponse>(path, { ...options, method: "GET" });
}

export function apiPost<TResponse>(path: string, body?: unknown, options: Omit<ApiRequestOptions, "body" | "method"> = {}) {
  return apiRequest<TResponse>(path, { ...options, method: "POST", body });
}

export function apiPatch<TResponse>(path: string, body?: unknown, options: Omit<ApiRequestOptions, "body" | "method"> = {}) {
  return apiRequest<TResponse>(path, { ...options, method: "PATCH", body });
}

export function apiDelete<TResponse>(path: string, body?: unknown, options: Omit<ApiRequestOptions, "body" | "method"> = {}) {
  return apiRequest<TResponse>(path, { ...options, method: "DELETE", body });
}
