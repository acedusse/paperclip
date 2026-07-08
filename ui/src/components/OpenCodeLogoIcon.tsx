/**
 * FILE: ui/src/components/OpenCodeLogoIcon.tsx
 * ABOUT: OpenCodeLogoIcon.tsx (components module).
 *
 * SECTIONS:
 *   [TAG: module] - OpenCodeLogoIcon.tsx (components module).
 */
// ==========================================
// [META: module]
// INTENT: OpenCodeLogoIcon.tsx (components module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "ui/src/components/OpenCodeLogoIcon.tsx", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
import { cn } from "../lib/utils";

interface OpenCodeLogoIconProps {
  className?: string;
}

export function OpenCodeLogoIcon({ className }: OpenCodeLogoIconProps) {
  return (
    <>
      <img
        src="/brands/opencode-logo-light-square.svg"
        alt="OpenCode"
        className={cn("dark:hidden", className)}
      />
      <img
        src="/brands/opencode-logo-dark-square.svg"
        alt="OpenCode"
        className={cn("hidden dark:block", className)}
      />
    </>
  );
}
// [END: module]
