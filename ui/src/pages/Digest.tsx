/**
 * FILE: ui/src/pages/Digest.tsx
 * ABOUT: Digest.tsx (pages module).
 *
 * SECTIONS:
 *   [TAG: module] - Digest.tsx (pages module).
 */
// ==========================================
// [META: module]
// INTENT: Digest.tsx (pages module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "ui/src/pages/Digest.tsx", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { digestsApi } from "../api/digests";
import { useCompany } from "../context/CompanyContext";
import { timeAgo } from "../lib/timeAgo";
import { pushSupported, subscribeToPush, unsubscribeFromPush } from "../lib/push";

export function Digest() {
  const { selectedCompanyId } = useCompany();
  const companyId = selectedCompanyId ?? "";
  const qc = useQueryClient();
  const { data: digest } = useQuery({
    queryKey: ["digest-latest", companyId],
    queryFn: () => digestsApi.latest(companyId),
    enabled: !!companyId,
    retry: false,
  });

  const generate = useMutation({
    mutationFn: () => digestsApi.generate(companyId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["digest-latest", companyId] }),
  });

  const pushEnabledSupported = pushSupported();
  const [pushEnabled, setPushEnabled] = useState(
    () => pushEnabledSupported && Notification.permission === "granted",
  );
  const [pushPending, setPushPending] = useState(false);

  const togglePush = async () => {
    if (!companyId || pushPending) return;
    setPushPending(true);
    try {
      if (pushEnabled) {
        await unsubscribeFromPush(companyId);
        setPushEnabled(false);
      } else {
        const ok = await subscribeToPush(companyId);
        if (ok) setPushEnabled(true);
      }
    } finally {
      setPushPending(false);
    }
  };

  return (
    <div className="digest-page space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Digest</h1>
        <div className="flex items-center gap-2">
          {pushEnabledSupported && (
            <button onClick={togglePush} disabled={!companyId || pushPending}>
              {pushPending
                ? "Working…"
                : pushEnabled
                  ? "Disable push notifications"
                  : "Enable push notifications"}
            </button>
          )}
          <button onClick={() => generate.mutate()} disabled={!companyId || generate.isPending}>
            {generate.isPending ? "Generating…" : "Generate now"}
          </button>
        </div>
      </div>
      {digest ? (
        <div className="digest">
          <h2 className="text-lg font-medium">{digest.payload.headline}</h2>
          <p className="text-xs text-muted-foreground">
            generated {timeAgo(digest.generatedAt)}
          </p>
          {digest.payload.sections.map((section) => (
            <section key={section.key} className="mt-3">
              <h3 className="font-medium">{section.title}</h3>
              <ul className="list-disc pl-5">
                {section.lines.map((line, i) => (
                  <li key={i}>{line}</li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      ) : (
        <p className="text-muted-foreground">No digest yet.</p>
      )}
    </div>
  );
}
// [END: module]
