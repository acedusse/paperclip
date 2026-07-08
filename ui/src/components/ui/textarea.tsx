/**
 * FILE: ui/src/components/ui/textarea.tsx
 * ABOUT: textarea.tsx (ui module).
 *
 * SECTIONS:
 *   [TAG: module] - textarea.tsx (ui module).
 */
// ==========================================
// [META: module]
// INTENT: textarea.tsx (ui module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "ui/src/components/ui/textarea.tsx", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
import * as React from "react"

import { cn } from "@/lib/utils"

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "border-input placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive dark:bg-input/30 flex field-sizing-content min-h-16 min-w-0 w-full max-w-full rounded-md border bg-transparent px-3 py-2 text-base shadow-xs transition-[color,box-shadow] outline-none focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
        className
      )}
      {...props}
    />
  )
}

export { Textarea }
// [END: module]
