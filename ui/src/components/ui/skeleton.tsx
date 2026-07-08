/**
 * FILE: ui/src/components/ui/skeleton.tsx
 * ABOUT: skeleton.tsx (ui module).
 *
 * SECTIONS:
 *   [TAG: module] - skeleton.tsx (ui module).
 */
// ==========================================
// [META: module]
// INTENT: skeleton.tsx (ui module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "ui/src/components/ui/skeleton.tsx", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
import { cn } from "@/lib/utils"

function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      className={cn("bg-accent/75 rounded-md", className)}
      {...props}
    />
  )
}

export { Skeleton }
// [END: module]
