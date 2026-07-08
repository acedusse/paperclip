/**
 * FILE: ui/src/lib/websocket-url.ts
 * ABOUT: websocket-url.ts (lib module).
 *
 * SECTIONS:
 *   [TAG: module] - websocket-url.ts (lib module).
 */
// ==========================================
// [META: module]
// INTENT: websocket-url.ts (lib module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "ui/src/lib/websocket-url.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
type BrowserLocationLike = Pick<Location, "host" | "hostname" | "port" | "protocol">;

function isWildcardHost(hostname: string): boolean {
  const normalized = hostname.trim().toLowerCase();
  return normalized === "0.0.0.0" || normalized === "::" || normalized === "[::]";
}

export function browserReachableHost(location: BrowserLocationLike = window.location): string {
  if (!isWildcardHost(location.hostname)) return location.host;
  return location.port ? `localhost:${location.port}` : "localhost";
}

export function buildSameOriginWebSocketUrl(
  path: string,
  location: BrowserLocationLike = window.location,
): string {
  const protocol = location.protocol === "https:" ? "wss" : "ws";
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${protocol}://${browserReachableHost(location)}${normalizedPath}`;
}
// [END: module]
