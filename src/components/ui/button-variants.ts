import { cva, type VariantProps } from "class-variance-authority";

// Pure cva class-builder for the Button component.
//
// This file does NOT have "use client" on purpose. buttonVariants is a
// plain string-returning function — it has no React, no client-only
// APIs — and server components need to call it when they want to style
// a <Link> or <a> like a button (common pattern on admin pages where a
// server-rendered page links to another route).
//
// Why a separate file instead of exporting from button.tsx:
//   button.tsx carries "use client" because the Button component wraps
//   base-ui's ButtonPrimitive, which needs the client runtime. Next.js
//   RSC treats every export from a "use client" module as a client
//   reference — so calling buttonVariants() from a server component
//   throws at render time:
//
//     "Attempted to call buttonVariants() from the server but
//      buttonVariants is on the client."
//
//   (We learned this the hard way on 2026-04-18: Commit 4b's server
//   user-detail page imported buttonVariants from button.tsx, build
//   passed, prod crashed on first render. See digest 2861797687.)
//
// Rule:
//   * Client components — import Button + buttonVariants from
//     "@/components/ui/button" (ergonomic, button.tsx re-exports).
//   * Server components — import buttonVariants from
//     "@/components/ui/button-variants" (this file, no client scope).

export const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center rounded-lg border border-transparent bg-clip-padding text-sm font-medium whitespace-nowrap transition-all outline-none select-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 active:not-aria-[haspopup]:translate-y-px disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground [a]:hover:bg-primary/80",
        outline:
          "border-border bg-background hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground dark:border-input dark:bg-input/30 dark:hover:bg-input/50",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-secondary/80 aria-expanded:bg-secondary aria-expanded:text-secondary-foreground",
        ghost:
          "hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground dark:hover:bg-muted/50",
        destructive:
          "bg-destructive/10 text-destructive hover:bg-destructive/20 focus-visible:border-destructive/40 focus-visible:ring-destructive/20 dark:bg-destructive/20 dark:hover:bg-destructive/30 dark:focus-visible:ring-destructive/40",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        // Default tap target hits 44px on mobile (accessibility minimum),
        // compacts to the existing 32/36px on md+. Explicit sm/xs/icon-sm/
        // icon-xs variants stay compact everywhere — they're opt-in density.
        default:
          "h-11 md:h-8 gap-1.5 px-2.5 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2",
        xs: "h-6 gap-1 rounded-[min(var(--radius-md),10px)] px-2 text-xs in-data-[slot=button-group]:rounded-lg has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-7 gap-1 rounded-[min(var(--radius-md),12px)] px-2.5 text-[0.8rem] in-data-[slot=button-group]:rounded-lg has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3.5",
        lg: "h-11 md:h-9 gap-1.5 px-2.5 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2",
        icon: "size-11 md:size-8",
        "icon-xs":
          "size-6 rounded-[min(var(--radius-md),10px)] in-data-[slot=button-group]:rounded-lg [&_svg:not([class*='size-'])]:size-3",
        "icon-sm":
          "size-7 rounded-[min(var(--radius-md),12px)] in-data-[slot=button-group]:rounded-lg",
        "icon-lg": "size-11 md:size-9",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
);

export type ButtonVariantProps = VariantProps<typeof buttonVariants>;
