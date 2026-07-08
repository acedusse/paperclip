/**
 * FILE: ui/src/components/access/ModeBadge.tsx
 * ABOUT: ModeBadge.tsx (access module).
 *
 * SECTIONS:
 *   [TAG: module] - ModeBadge.tsx (access module).
 */
// ==========================================
// [META: module]
// INTENT: ModeBadge.tsx (access module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "ui/src/components/access/ModeBadge.tsx", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
import type { DeploymentExposure, DeploymentMode } from "@paperclipai/shared";
import { Badge } from "@/components/ui/badge";

export function ModeBadge({
  deploymentMode,
  deploymentExposure,
}: {
  deploymentMode?: DeploymentMode;
  deploymentExposure?: DeploymentExposure;
}) {
  if (!deploymentMode) return null;

  const label =
    deploymentMode === "local_trusted"
      ? "Local trusted"
      : `Authenticated ${deploymentExposure ?? "private"}`;

  return <Badge variant="outline">{label}</Badge>;
}
// [END: module]
