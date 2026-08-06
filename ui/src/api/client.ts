/**
 * FILE: ui/src/api/client.ts
 * ABOUT: client.ts (api module).
 *
 * SECTIONS:
 *   [TAG: module] - client.ts (api module).
 */
// ==========================================
// [META: module]
// INTENT: client.ts (api module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "ui/src/api/client.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
import { applyTelegramAuthHeader, getTelegramBearer, refreshTelegramBearer } from "../telegram/useTelegramSession";

const BASE = "/api";

export class ApiError extends Error {
  status: number;
  body: unknown;

  constructor(message: string, status: number, body: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  // Outside Telegram, applyTelegramAuthHeader is always a no-op, so nothing changes for the ordinary
  // board (which authenticates via the session cookie sent through credentials: "include").
  const buildHeaders = (): Headers => {
    const headers = new Headers(init?.headers ?? undefined);
    const body = init?.body;
    if (!(body instanceof FormData) && !headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }
    applyTelegramAuthHeader(headers);
    return headers;
  };

  const hadBearer = getTelegramBearer() !== null;
  let res = await fetch(`${BASE}${path}`, {
    headers: buildHeaders(),
    credentials: "include",
    ...init,
  });

  // The Mini App's 12-hour bearer can expire mid-session. Re-mint once from the initData the webview
  // still holds and retry this same request -- outside Telegram, or if the binding was revoked,
  // refreshTelegramBearer() returns null and this falls through to the ordinary 401 handling below.
  if (res.status === 401 && hadBearer) {
    const fresh = await refreshTelegramBearer();
    if (fresh) {
      res = await fetch(`${BASE}${path}`, {
        headers: buildHeaders(),
        credentials: "include",
        ...init,
      });
    }
  }

  if (!res.ok) {
    const errorBody = await res.json().catch(() => null);
    throw new ApiError(
      (errorBody as { error?: string } | null)?.error ?? `Request failed: ${res.status}`,
      res.status,
      errorBody,
    );
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body: unknown) =>
    request<T>(path, { method: "POST", body: JSON.stringify(body) }),
  postForm: <T>(path: string, body: FormData) =>
    request<T>(path, { method: "POST", body }),
  put: <T>(path: string, body: unknown) =>
    request<T>(path, { method: "PUT", body: JSON.stringify(body) }),
  patch: <T>(path: string, body: unknown) =>
    request<T>(path, { method: "PATCH", body: JSON.stringify(body) }),
  delete: <T>(path: string, body?: unknown) =>
    request<T>(path, {
      method: "DELETE",
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    }),
};
// [END: module]
