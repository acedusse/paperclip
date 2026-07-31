/**
 * FILE: ui/src/pages/StakeholderPage.tsx
 * ABOUT: Public, unauthenticated stakeholder transparency page.
 *
 * SECTIONS:
 *   [TAG: module] - StakeholderPage.tsx (pages module).
 */
// ==========================================
// [META: module]
// INTENT: Render a curated, read-only company snapshot for a share token.
// PSEUDOCODE: 1. Fetch by token. 2. Render only the sections the payload
//             actually contains. 3. Show a neutral not-found for any failure.
// JSON_FLOW: {"file": "ui/src/pages/StakeholderPage.tsx", "imports": "see code", "exports": "StakeholderPage"}
// ==========================================
// [START: module]
import { useQuery } from "@tanstack/react-query";
import { useParams } from "react-router-dom";
import { stakeholderSharesApi, type StakeholderPayload } from "../api/stakeholder-shares";

export function StakeholderView({ payload }: { payload: StakeholderPayload }) {
  const hasAnySection =
    Boolean(payload.narrative) ||
    Boolean(payload.goalProgress) ||
    Boolean(payload.shippedWork) ||
    Boolean(payload.activityTimeline);

  return (
    <div className="mx-auto max-w-2xl px-6 py-12">
      <h1 className="text-2xl font-semibold">{payload.companyName}</h1>

      {!hasAnySection && (
        <p className="mt-6 text-sm text-muted-foreground">Nothing has been shared yet.</p>
      )}

      {payload.narrative && (
        <section className="mt-8" data-testid="section-narrative">
          <h2 className="text-sm font-medium text-muted-foreground">Summary</h2>
          <p className="mt-2 whitespace-pre-line text-sm">{payload.narrative.text}</p>
        </section>
      )}

      {payload.goalProgress && (
        <section className="mt-8" data-testid="section-goal-progress">
          <h2 className="text-sm font-medium text-muted-foreground">Goals</h2>
          <ul className="mt-2 space-y-1 text-sm">
            {payload.goalProgress.goals.map((goal) => (
              <li key={`${goal.title}-${goal.status}`} className="flex justify-between gap-4">
                <span>{goal.title}</span>
                <span className="text-muted-foreground">{goal.status}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {payload.shippedWork && (
        <section className="mt-8" data-testid="section-shipped-work">
          <h2 className="text-sm font-medium text-muted-foreground">Recently shipped</h2>
          <ul className="mt-2 space-y-1 text-sm">
            {payload.shippedWork.map((item) => (
              <li key={`${item.title}-${item.completedAt}`}>{item.title}</li>
            ))}
          </ul>
        </section>
      )}

      {payload.activityTimeline && (
        <section className="mt-8" data-testid="section-activity-timeline">
          <h2 className="text-sm font-medium text-muted-foreground">Recent activity</h2>
          <ul className="mt-2 space-y-1 text-sm">
            {payload.activityTimeline.map((entry) => (
              <li key={`${entry.at}-${entry.label}`}>{entry.label}</li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

export function StakeholderPage() {
  const { token } = useParams<{ token: string }>();
  const { data, isLoading, isError } = useQuery({
    queryKey: ["stakeholder-share", token],
    queryFn: () => stakeholderSharesApi.publicView(token as string),
    enabled: Boolean(token),
    retry: false,
  });

  if (isLoading) {
    return <div className="mx-auto max-w-2xl px-6 py-12 text-sm text-muted-foreground">Loading...</div>;
  }

  // Revoked, expired and unknown tokens all 404 — show one neutral message for
  // every failure so the page cannot confirm that a link ever existed.
  if (isError || !data) {
    return (
      <div className="mx-auto max-w-2xl px-6 py-12">
        <h1 className="text-lg font-semibold">This link is not available</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          It may have been revoked or expired. Ask whoever shared it for a new link.
        </p>
      </div>
    );
  }

  return <StakeholderView payload={data} />;
}
// [END: module]
