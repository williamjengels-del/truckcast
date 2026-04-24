import * as React from "react"

import { cn } from "@/lib/utils"

// Native <input>, not @base-ui/react/input.
//
// Why: Base UI's Input is a passthrough to Field.Control which expects
// a <Field.Root> parent. Used standalone (as every shared caller does
// here), Field.Control still subscribes to an implicit Field context
// and fires setFilled / setFocused / setDirty into it on every render
// via a useIsoLayoutEffect. That cascades re-renders that swap the
// input's ref and drop focus after the first keystroke — the
// "one-letter-at-a-time" bug originally reported 2026-04-21, still
// present after a useMemo refactor that ruled out render cost.
//
// Native <input> has none of that machinery. Same className, same
// props surface — any caller passing value+onChange gets a standard
// controlled input that holds focus normally.
//
// If a caller in the future wants Field integration, use Base UI's
// Input directly inside a <Field.Root>, not through this component.
function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "h-11 md:h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1 text-base transition-colors outline-none file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 md:text-sm dark:bg-input/30 dark:disabled:bg-input/80 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40",
        className
      )}
      {...props}
    />
  )
}

export { Input }
