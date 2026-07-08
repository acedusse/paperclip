/**
 * FILE: ui/src/components/MissingPluginTabPlaceholder.tsx
 * ABOUT: MissingPluginTabPlaceholder.tsx (components module).
 *
 * SECTIONS:
 *   [TAG: module] - MissingPluginTabPlaceholder.tsx (components module).
 */
// ==========================================
// [META: module]
// INTENT: MissingPluginTabPlaceholder.tsx (components module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "ui/src/components/MissingPluginTabPlaceholder.tsx", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
import { Link } from "@/lib/router";
import { Button } from "@/components/ui/button";

interface MissingPluginTabPlaceholderProps {
  defaultTabHref: string;
  defaultTabLabel: string;
}

export function MissingPluginTabPlaceholder({
  defaultTabHref,
  defaultTabLabel,
}: MissingPluginTabPlaceholderProps) {
  return (
    <div className="rounded-lg border border-dashed border-border bg-background px-4 py-8 text-sm text-muted-foreground">
      <div className="flex flex-col items-start gap-3">
        <p>Workspace plugin tab is not available.</p>
        <Button variant="outline" size="sm" asChild>
          <Link to={defaultTabHref}>{defaultTabLabel}</Link>
        </Button>
      </div>
    </div>
  );
}
// [END: module]
