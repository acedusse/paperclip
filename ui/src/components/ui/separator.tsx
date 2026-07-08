"use client"
/**
 * FILE: ui/src/components/ui/separator.tsx
 * ABOUT: separator.tsx (ui module).
 *
 * SECTIONS:
 *   [TAG: module] - separator.tsx (ui module).
 */
// ==========================================
// [META: module]
// INTENT: separator.tsx (ui module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "ui/src/components/ui/separator.tsx", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]

import * as React from "react"
import { Separator as SeparatorPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"

function Separator({
  className,
  orientation = "horizontal",
  decorative = true,
  ...props
}: React.ComponentProps<typeof SeparatorPrimitive.Root>) {
  return (
    <SeparatorPrimitive.Root
      data-slot="separator"
      decorative={decorative}
      orientation={orientation}
      className={cn(
        "bg-border shrink-0 data-[orientation=horizontal]:h-px data-[orientation=horizontal]:w-full data-[orientation=vertical]:h-full data-[orientation=vertical]:w-px",
        className
      )}
      {...props}
    />
  )
}

export { Separator }
// [END: module]
