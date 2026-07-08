/**
 * FILE: ui/src/components/IssueReferencePill.tsx
 * ABOUT: IssueReferencePill.tsx (components module).
 *
 * SECTIONS:
 *   [TAG: module] - IssueReferencePill.tsx (components module).
 */
// ==========================================
// [META: module]
// INTENT: IssueReferencePill.tsx (components module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "ui/src/components/IssueReferencePill.tsx", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
import type { ReactNode } from "react";
import type { IssueRelationIssueSummary } from "@paperclipai/shared";
import { Link } from "@/lib/router";
import { cn } from "../lib/utils";
import { StatusIcon } from "./StatusIcon";

export function IssueReferencePill({
  issue,
  strikethrough,
  className,
  children,
}: {
  issue: Pick<IssueRelationIssueSummary, "id" | "identifier" | "title"> &
    Partial<Pick<IssueRelationIssueSummary, "status">>;
  strikethrough?: boolean;
  className?: string;
  children?: ReactNode;
}) {
  const issueLabel = issue.identifier ?? issue.title;
  const classNames = cn(
    "paperclip-mention-chip paperclip-mention-chip--issue",
    "inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-xs no-underline",
    issue.identifier && "hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring",
    strikethrough && "opacity-60 line-through decoration-muted-foreground",
    className,
  );
  const content = (
    <>
      {issue.status ? <StatusIcon status={issue.status} className="h-3 w-3 shrink-0" /> : null}
      {children !== undefined ? children : <span>{issue.identifier ?? issue.title}</span>}
    </>
  );

  if (!issue.identifier) {
    return (
      <span
        data-mention-kind="issue"
        className={classNames}
        title={issue.title}
        aria-label={`Task: ${issue.title}`}
      >
        {content}
      </span>
    );
  }

  return (
    <Link
      to={`/issues/${issueLabel}`}
      data-mention-kind="issue"
      className={classNames}
      title={issue.title}
      aria-label={`Task ${issueLabel}: ${issue.title}`}
    >
      {content}
    </Link>
  );
}
// [END: module]
