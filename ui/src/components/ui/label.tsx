/**
 * FILE: ui/src/components/ui/label.tsx
 * ABOUT: label.tsx (ui module).
 *
 * SECTIONS:
 *   [TAG: module] - label.tsx (ui module).
 */
// ==========================================
// [META: module]
// INTENT: label.tsx (ui module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "ui/src/components/ui/label.tsx", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
import * as React from "react"
import { Label as LabelPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"

function Label({
  className,
  ...props
}: React.ComponentProps<typeof LabelPrimitive.Root>) {
  return (
    <LabelPrimitive.Root
      data-slot="label"
      className={cn(
        "flex items-center gap-2 text-sm leading-none font-medium select-none group-data-[disabled=true]:pointer-events-none group-data-[disabled=true]:opacity-50 peer-disabled:cursor-not-allowed peer-disabled:opacity-50",
        className
      )}
      {...props}
    />
  )
}

export { Label }
// [END: module]
