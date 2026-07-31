/**
 * FILE: ui/src/pages/CompanyPreflight.tsx
 * ABOUT: Combo-10 Phase 1 — company launch-readiness (preflight) panel.
 *
 * SECTIONS:
 *   [TAG: module] - CompanyPreflight.tsx (pages module).
 */
// ==========================================
// [META: module]
// INTENT: Show the operator what will stop this company launching, before they hit go.
// PSEUDOCODE: 1. Fetch report. 2. Render traffic light. 3. List findings by severity.
// JSON_FLOW: {"file": "ui/src/pages/CompanyPreflight.tsx", "imports": "companyPreflightApi", "exports": "CompanyPreflight"}
// ==========================================
// [START: module]
import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useCompany } from "../context/CompanyContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { companyPreflightApi } from "../api/companyPreflight";
import { queryKeys } from "../lib/queryKeys";
import { Button } from "@/components/ui/button";
import { PageSkeleton } from "../components/PageSkeleton";
import {
  groupFindingsByLevel,
  levelBadgeClass,
  levelLabel,
  statusSummary,
} from "../lib/preflight-display";

export function CompanyPreflight() {
  const { selectedCompanyId } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();

  useEffect(() => {
    setBreadcrumbs([{ label: "Preflight" }]);
  }, [setBreadcrumbs]);

  const { data: report, isLoading, isFetching, refetch } = useQuery({
    queryKey: queryKeys.companyPreflight(selectedCompanyId!),
    queryFn: () => companyPreflightApi.report(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  if (isLoading) return <PageSkeleton />;

  const summary = statusSummary(report);
  const groups = groupFindingsByLevel(report?.findings ?? []);

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 p-6">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <span
            data-testid="preflight-status-dot"
            className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${summary.dotClass}`}
          />
          <div>
            <h1 className="text-lg font-semibold text-foreground">{summary.label}</h1>
            <p className="mt-0.5 text-sm text-muted-foreground">{summary.detail}</p>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={() => void refetch()} disabled={isFetching}>
          {isFetching ? "Checking…" : "Re-run checks"}
        </Button>
      </div>

      {groups.length === 0 && (
        <p className="rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">
          Nothing to fix. Every preflight check passed.
        </p>
      )}

      {groups.map((group) => (
        <section key={group.level} className="flex flex-col gap-2">
          {group.findings.map((finding, index) => (
            <article
              key={`${finding.code}-${index}`}
              data-testid="preflight-finding"
              data-level={finding.level}
              className="rounded-lg border border-border bg-card p-4"
            >
              <div className="flex items-center gap-2">
                <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${levelBadgeClass(finding.level)}`}>
                  {levelLabel(finding.level)}
                </span>
                <span className="font-mono text-[11px] text-muted-foreground/70">{finding.code}</span>
              </div>
              <p className="mt-2 text-sm text-foreground">{finding.message}</p>
              {/* The hint is the point of the panel — it is what the operator does next. */}
              <p className="mt-1 text-sm text-muted-foreground">{finding.hint}</p>
            </article>
          ))}
        </section>
      ))}
    </div>
  );
}

export default CompanyPreflight;
// [END: module]
