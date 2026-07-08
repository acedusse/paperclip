/**
 * FILE: ui/src/components/IssuesQuicklook.tsx
 * ABOUT: IssuesQuicklook.tsx (components module).
 *
 * SECTIONS:
 *   [TAG: module] - IssuesQuicklook.tsx (components module).
 */
// ==========================================
// [META: module]
// INTENT: IssuesQuicklook.tsx (components module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "ui/src/components/IssuesQuicklook.tsx", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
import { useState } from "react";
import type { Issue } from "@paperclipai/shared";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { createIssueDetailPath, withIssueDetailHeaderSeed } from "../lib/issueDetailBreadcrumb";
import { IssueQuicklookCard } from "./IssueLinkQuicklook";

interface IssuesQuicklookProps {
  issue: Issue;
  children: React.ReactNode;
}

export function IssuesQuicklook({ issue, children }: IssuesQuicklookProps) {
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        asChild
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
      >
        {children}
      </PopoverTrigger>
      <PopoverContent
        className="w-72 p-3"
        side="top"
        align="start"
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <IssueQuicklookCard
          issue={issue}
          linkTo={createIssueDetailPath(issue.identifier ?? issue.id)}
          linkState={withIssueDetailHeaderSeed(null, issue)}
        />
      </PopoverContent>
    </Popover>
  );
}
// [END: module]
