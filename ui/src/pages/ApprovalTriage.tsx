/**
 * FILE: ui/src/pages/ApprovalTriage.tsx
 * ABOUT: ApprovalTriage.tsx (pages module).
 *
 * SECTIONS:
 *   [TAG: module] - ApprovalTriage.tsx (pages module).
 */
// ==========================================
// [META: module]
// INTENT: ApprovalTriage.tsx (pages module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "ui/src/pages/ApprovalTriage.tsx", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { approvalsApi } from "../api/approvals";
import { useCompany } from "../context/CompanyContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { queryKeys } from "../lib/queryKeys";
import { cn } from "../lib/utils";
import { PageSkeleton } from "../components/PageSkeleton";
import { ShieldCheck } from "lucide-react";

type BulkAction = "approve" | "reject" | "request_changes";

const RISK_BAND_ORDER = ["critical", "high", "medium", "low"] as const;

const RISK_BAND_CLASSES: Record<string, string> = {
  critical: "bg-red-600/90 text-red-50",
  high: "bg-orange-500/20 text-orange-500",
  medium: "bg-yellow-500/20 text-yellow-500",
  low: "bg-muted text-muted-foreground",
};

export function ApprovalTriage() {
  const { selectedCompanyId } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const qc = useQueryClient();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    setBreadcrumbs([{ label: "Approvals", href: "/approvals" }, { label: "Triage" }]);
  }, [setBreadcrumbs]);

  const { data, isLoading, error } = useQuery({
    queryKey: queryKeys.approvals.triage(selectedCompanyId!),
    queryFn: () => approvalsApi.triage(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  const items = data?.items ?? [];
  const groups = data?.groups ?? [];

  const bulk = useMutation({
    mutationFn: (action: BulkAction) =>
      approvalsApi.bulk(selectedCompanyId!, { ids: [...selected], action }),
    onSuccess: () => {
      setActionError(null);
      setSelected(new Set());
      qc.invalidateQueries({ queryKey: queryKeys.approvals.triage(selectedCompanyId!) });
    },
    onError: (err) => {
      setActionError(err instanceof Error ? err.message : "Bulk action failed");
    },
  });

  const toggle = (id: string) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const toggleGroup = (ids: string[]) =>
    setSelected((s) => {
      const allSelected = ids.every((id) => s.has(id));
      const next = new Set(s);
      if (allSelected) {
        for (const id of ids) next.delete(id);
      } else {
        for (const id of ids) next.add(id);
      }
      return next;
    });

  if (!selectedCompanyId) {
    return <p className="text-sm text-muted-foreground">Select a company first.</p>;
  }

  if (isLoading) {
    return <PageSkeleton variant="approvals" />;
  }

  return (
    <div className="approval-triage space-y-4">
      {error && <p className="text-sm text-destructive">{error.message}</p>}
      {actionError && <p className="text-sm text-destructive">{actionError}</p>}

      <div className="approval-triage__actions flex items-center gap-2">
        <button
          type="button"
          className="rounded-md border border-border px-3 py-1.5 text-sm font-medium hover:bg-accent/50 disabled:opacity-50"
          disabled={!selected.size || bulk.isPending}
          onClick={() => bulk.mutate("approve")}
        >
          Approve selected
        </button>
        <button
          type="button"
          className="rounded-md border border-border px-3 py-1.5 text-sm font-medium hover:bg-accent/50 disabled:opacity-50"
          disabled={!selected.size || bulk.isPending}
          onClick={() => bulk.mutate("reject")}
        >
          Reject selected
        </button>
        <button
          type="button"
          className="rounded-md border border-border px-3 py-1.5 text-sm font-medium hover:bg-accent/50 disabled:opacity-50"
          disabled={!selected.size || bulk.isPending}
          onClick={() => bulk.mutate("request_changes")}
        >
          Request changes
        </button>
        <span className="text-xs text-muted-foreground">
          {selected.size} selected
        </span>
      </div>

      {groups.length > 0 && (
        <ul className="approval-triage__groups flex flex-wrap gap-2">
          {groups.map((g) => {
            const allSelected = g.ids.length > 0 && g.ids.every((id) => selected.has(id));
            return (
              <li key={g.key}>
                <button
                  type="button"
                  className={cn(
                    "rounded-full border border-border px-3 py-1 text-xs font-medium hover:bg-accent/50",
                    allSelected && "bg-accent text-foreground",
                  )}
                  aria-pressed={allSelected}
                  onClick={() => toggleGroup(g.ids)}
                >
                  {g.type} · {g.ids.length} items
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {items.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <ShieldCheck className="h-8 w-8 text-muted-foreground/30 mb-3" />
          <p className="text-sm text-muted-foreground">Nothing to triage.</p>
        </div>
      )}

      {items.length > 0 && (
        <ul className="approval-triage__items divide-y divide-border rounded-md border border-border">
          {/* items are pre-sorted highest-risk-first by the server; render as-is. */}
          {items.map((it: any) => (
            <li
              key={it.id}
              data-approval-triage-item={it.id}
              className="flex items-center gap-3 px-3 py-2"
            >
              <input
                type="checkbox"
                checked={selected.has(it.id)}
                onChange={() => toggle(it.id)}
                aria-label={`select ${it.id}`}
              />
              <span
                className={cn(
                  "rounded-full px-2 py-0.5 text-[10px] font-medium uppercase",
                  RISK_BAND_CLASSES[it.risk?.band] ?? RISK_BAND_CLASSES.low,
                )}
              >
                {it.risk?.band ?? "low"}
              </span>
              <span className="text-sm">{it.type}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// Exported for tests/tooling that want a stable risk-band precedence reference.
export const APPROVAL_TRIAGE_RISK_BAND_ORDER = RISK_BAND_ORDER;
// [END: module]
