/**
 * FILE: ui/public/sw.js
 * ABOUT: sw.js (public module).
 *
 * SECTIONS:
 *   [TAG: module] - sw.js (public module).
 */
// ==========================================
// [META: module]
// INTENT: sw.js (public module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "ui/public/sw.js", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
const CACHE_NAME = "paperclip-v2";

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.map((key) => caches.delete(key)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET requests and API calls
  if (request.method !== "GET" || url.pathname.startsWith("/api")) {
    return;
  }

  // Network-first for everything — cache is only an offline fallback
  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok && url.origin === self.location.origin) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
        }
        return response;
      })
      .catch(() => {
        if (request.mode === "navigate") {
          return caches.match("/") || new Response("Offline", { status: 503 });
        }
        return caches.match(request);
      })
  );
});

self.addEventListener("push", (event) => {
  const data = event.data ? event.data.json() : {};
  const isApproval = typeof data.approvalId === "string";
  event.waitUntil(
    self.registration.showNotification(data.title || "Paperclip", {
      body: data.body || "",
      tag: data.tag,
      data: { url: data.url, approvalId: data.approvalId ?? null },
      actions: isApproval
        ? [
            { action: "approve", title: "Approve" },
            { action: "reject", title: "Reject" },
          ]
        : [],
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  const data = event.notification.data || {};
  const url = data.url;
  const approvalId = data.approvalId;
  event.notification.close();

  if ((event.action === "approve" || event.action === "reject") && approvalId) {
    event.waitUntil(
      fetch(`/api/approvals/${approvalId}/${event.action}`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      })
        .then((res) => {
          if (res.ok) {
            return self.registration.showNotification("Paperclip", {
              body: event.action === "approve" ? "Approved." : "Rejected.",
              tag: `approval-${approvalId}-done`,
            });
          }
          return openApproval(url);
        })
        .catch(() => openApproval(url)),
    );
    return;
  }

  event.waitUntil(openApproval(url));
});

function openApproval(url) {
  const target = url || "/";
  return self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
    for (const client of clients) {
      if (client.url.endsWith(target) && "focus" in client) return client.focus();
    }
    return self.clients.openWindow(target);
  });
}
// [END: module]
