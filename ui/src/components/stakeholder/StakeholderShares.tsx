/**
 * FILE: ui/src/components/stakeholder/StakeholderShares.tsx
 * ABOUT: Operator management for Combo-05 Phase 4c stakeholder shares.
 *
 * SECTIONS:
 *   [TAG: module] - StakeholderShares.tsx (components module).
 */
// ==========================================
// [META: module]
// INTENT: Create, curate, rotate and revoke stakeholder transparency links.
// PSEUDOCODE: 1. List shares. 2. Create with all toggles off. 3. Toggle
//             per-section exposure. 4. Rotate / revoke.
// JSON_FLOW: {"file": "ui/src/components/stakeholder/StakeholderShares.tsx", "imports": "see code", "exports": "StakeholderShares"}
// ==========================================
// [START: module]
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { stakeholderSharesApi, type StakeholderShare } from "../../api/stakeholder-shares";

const TOGGLES = [
  ["showGoalProgress", "Goal progress"],
  ["showShippedWork", "Recently shipped"],
  ["showNarrative", "Summary paragraph"],
  ["showActivityTimeline", "Activity timeline"],
] as const;

type ToggleKey = (typeof TOGGLES)[number][0];

export function StakeholderShares({ companyId }: { companyId: string }) {
  const qc = useQueryClient();
  const [label, setLabel] = useState("");
  const [freshToken, setFreshToken] = useState<string | null>(null);

  const { data: shares } = useQuery({
    queryKey: ["stakeholder-shares", companyId],
    queryFn: () => stakeholderSharesApi.list(companyId),
    enabled: Boolean(companyId),
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ["stakeholder-shares", companyId] });

  const create = useMutation({
    mutationFn: () => stakeholderSharesApi.create(companyId, { label }),
    onSuccess: (share) => {
      setFreshToken(share.token);
      setLabel("");
      void invalidate();
    },
  });

  const patch = useMutation({
    mutationFn: (input: { id: string; key: ToggleKey; value: boolean }) =>
      stakeholderSharesApi.update(input.id, { [input.key]: input.value }),
    onSuccess: () => void invalidate(),
  });

  const revoke = useMutation({
    mutationFn: (id: string) => stakeholderSharesApi.revoke(id),
    onSuccess: () => void invalidate(),
  });

  const rotate = useMutation({
    mutationFn: (id: string) => stakeholderSharesApi.rotate(id),
    onSuccess: (share) => {
      setFreshToken(share.token);
      void invalidate();
    },
  });

  return (
    <section className="stakeholder-shares mt-6 border-t pt-4">
      <h2 className="text-lg font-medium">Stakeholder sharing</h2>
      <p className="text-xs text-muted-foreground mt-1">
        Read-only links for people outside the board. Every section starts hidden — switch on only
        what you want shared.
      </p>

      <div className="mt-3 flex gap-2">
        <input
          aria-label="Link name"
          placeholder="e.g. Acme investors"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
        />
        <button onClick={() => create.mutate()} disabled={!label.trim() || create.isPending}>
          {create.isPending ? "Creating…" : "Create link"}
        </button>
      </div>

      {freshToken && (
        <p className="mt-2 text-xs" data-testid="fresh-token">
          Copy this link now — it is shown only once:{" "}
          <code>{`${window.location.origin}/s/${freshToken}`}</code>
        </p>
      )}

      <ul className="mt-4 space-y-3">
        {(shares ?? []).map((share: StakeholderShare) => (
          <li key={share.id} className="border-t pt-3" data-testid={`share-${share.id}`}>
            <div className="flex items-center gap-2">
              <span className="font-medium">{share.label}</span>
              <span className="text-xs text-muted-foreground">…{share.tokenTail}</span>
              {share.status !== "active" && (
                <span className="text-xs text-destructive">revoked</span>
              )}
              {share.expiresAt && (
                <span className="text-xs text-muted-foreground">
                  expires {new Date(share.expiresAt).toLocaleDateString()}
                </span>
              )}
            </div>

            <div className="mt-2 flex flex-wrap gap-3">
              {TOGGLES.map(([key, title]) => (
                <label key={key} className="text-xs flex items-center gap-1">
                  <input
                    type="checkbox"
                    aria-label={`${title} for ${share.label}`}
                    checked={share[key]}
                    disabled={share.status !== "active"}
                    onChange={(e) => patch.mutate({ id: share.id, key, value: e.target.checked })}
                  />
                  {title}
                </label>
              ))}
            </div>

            <div className="mt-2 flex gap-2">
              <button onClick={() => rotate.mutate(share.id)} disabled={share.status !== "active"}>
                Rotate link
              </button>
              <button onClick={() => revoke.mutate(share.id)} disabled={share.status !== "active"}>
                Revoke
              </button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
// [END: module]
