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
import { pushApi, type PushPrefs } from "../api/push";
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

  const { data: prefs } = useQuery({
    queryKey: ["push-prefs", companyId],
    queryFn: () => pushApi.getPrefs(companyId),
    enabled: !!companyId && pushEnabledSupported,
    retry: false,
  });
  const { data: devices } = useQuery({
    queryKey: ["push-devices", companyId],
    queryFn: () => pushApi.listDevices(companyId),
    enabled: !!companyId && pushEnabledSupported,
    retry: false,
  });
  const [form, setForm] = useState<PushPrefs | null>(null);
  const current = form ?? prefs ?? { minBand: "high" as const, quietStart: null, quietEnd: null, timezone: null };
  const savePrefs = useMutation({
    mutationFn: (p: PushPrefs) =>
      pushApi.putPrefs(companyId, {
        ...p,
        timezone: p.quietStart ? Intl.DateTimeFormat().resolvedOptions().timeZone : null,
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["push-prefs", companyId] }),
  });
  const removeDevice = useMutation({
    mutationFn: (id: string) => pushApi.removeDevice(companyId, id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["push-devices", companyId] }),
  });

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
      {pushEnabledSupported && (
        <section className="notifications mt-6 border-t pt-4">
          <h2 className="text-lg font-medium">Notifications</h2>
          <label className="block mt-2">
            Minimum band
            <select
              value={current.minBand}
              onChange={(e) => setForm({ ...current, minBand: e.target.value as PushPrefs["minBand"] })}
            >
              <option value="high">High and above</option>
              <option value="critical">Critical only</option>
            </select>
          </label>
          <label className="block mt-2">
            Quiet hours
            <input
              type="time"
              value={current.quietStart ?? ""}
              onChange={(e) => setForm({ ...current, quietStart: e.target.value || null })}
            />
            <input
              type="time"
              value={current.quietEnd ?? ""}
              onChange={(e) => setForm({ ...current, quietEnd: e.target.value || null })}
            />
          </label>
          <button className="mt-2" onClick={() => savePrefs.mutate(current)} disabled={savePrefs.isPending}>
            {savePrefs.isPending ? "Saving…" : "Save notification settings"}
          </button>

          <h3 className="font-medium mt-4">Your devices</h3>
          <ul className="list-disc pl-5">
            {(devices ?? []).map((d) => (
              <li key={d.id}>
                {d.label ?? d.userAgent ?? "Unknown device"}{" "}
                <span className="text-xs text-muted-foreground">…{d.endpointTail}</span>{" "}
                <button onClick={() => removeDevice.mutate(d.id)}>Remove</button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
// [END: module]
