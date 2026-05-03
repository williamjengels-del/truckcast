# Design tokens

**Source of truth:** `src/app/globals.css` (`:root` for light mode, `.dark` for dark mode).
**Tailwind utility mapping:** `src/app/globals.css → @theme inline` block.
**Provenance of values:** Brad Hatton's Figma Make HTML preview, captured 2026-04-27 by Julian. PR #30 landed the swap.

If you are about to change a brand color, update the value in `:root` (and `.dark` if it should differ) — every consumer picks it up automatically.

---

## Brand colors (named tokens)

These are the colors that signal "VendCast" — hero accents, callouts, accent stripes on insight cards. Distinct from semantic role tokens (`--primary`, `--muted`, etc.) so brand can evolve without disturbing role-based styling.

| Token | Light + Dark | Tailwind utility | Use |
|---|---|---|---|
| `--vendcast-teal` | `#0d4f5c` | `bg-brand-teal`, `text-brand-teal`, `border-brand-teal`, `*-brand-teal/<opacity>` | Hero band, primary accent stripes, "Vend" half of two-tone wordmark |
| `--vendcast-orange` | `#e8621a` | `bg-brand-orange`, `text-brand-orange`, `border-brand-orange`, `*-brand-orange/<opacity>` | Callouts, secondary accent stripes, "Cast" half of two-tone wordmark |

Brand tokens are intentionally identical between light and dark — deep teal still works against a near-black dark-mode background, and saturated orange pops against either.

---

## Semantic role tokens

These are what most components consume. Don't reference brand tokens directly in component-level code unless the design intent is brand-specific (hero band, callout, accent stripe). Reach for the role token first.

### Light mode (`:root`)

| Token | Value | Notes |
|---|---|---|
| `--background` | `#fff` | Page background |
| `--foreground` | `oklch(14.5% 0 0)` | Body text |
| `--card` / `--card-foreground` | `#fff` / `oklch(14.5% 0 0)` | Card surfaces |
| `--popover` / `--popover-foreground` | `#fff` / `oklch(14.5% 0 0)` | Popovers, dropdowns |
| `--primary` | `#030213` | Most-emphasized text + buttons. Near-black with a hint of dark blue. |
| `--primary-foreground` | `#fff` | Text on primary background (white) |
| `--secondary` | `oklch(95% 0.0058 264.53)` | Lower-emphasis surfaces, slightly cool |
| `--muted` / `--muted-foreground` | `#ececf0` / `#717182` | Muted surfaces + text |
| `--accent` / `--accent-foreground` | `#e9ebef` / `#030213` | Accent surfaces |
| `--destructive` / `--destructive-foreground` | `#d4183d` / `#fff` | Errors, delete confirmations |
| `--warning` / `--warning-foreground` | `#b45309` / `#fff` (light) · `oklch(0.78 0.16 70)` / `oklch(0.2 0 0)` (dark) | Caution states — payment-failed, validation hints, unresolved-but-fixable. Distinct from `--destructive` (red errors) and `--vendcast-orange` (brand CTA). Use `bg-warning/15 text-warning` for soft tints. |
| `--border` | `#0000001a` (10% black) | Default borders |
| `--input` / `--input-background` | `transparent` / `#f3f3f5` | Inputs |
| `--switch-background` | `#cbced4` | Switch off-state |
| `--ring` | `oklch(70.8% 0 0)` | Focus rings |

### Charts

| Token | Value |
|---|---|
| `--chart-1` | `oklch(64.6% 0.222 41.116)` (warm orange) |
| `--chart-2` | `oklch(60% 0.118 184.704)` (mid teal) |
| `--chart-3` | `oklch(39.8% 0.07 227.392)` (deep teal) |
| `--chart-4` | `oklch(82.8% 0.189 84.429)` (yellow-gold) |
| `--chart-5` | `oklch(76.9% 0.188 70.08)` (gold) |

These are real OKLCH-based brand-consistent chart colors, replacing our previous monochrome greys. Recharts in `src/app/dashboard/**` consumes these via Tailwind's `text-chart-N` / `fill-chart-N` utility classes.

### Sidebar (used by `src/components/ui/sidebar.tsx`)

`--sidebar`, `--sidebar-foreground`, `--sidebar-primary`, `--sidebar-primary-foreground`, `--sidebar-accent`, `--sidebar-accent-foreground`, `--sidebar-border`, `--sidebar-ring` — see `:root` in `globals.css` for current values. Aligned with the rest of the role-token system.

### Geometry + typography

| Token | Value |
|---|---|
| `--radius` | `0.625rem` |
| `--font-size` (Brad's Figma) | `16px` (we don't override) |
| Body font | **Geist** (Vercel sans, loaded via `next/font/google` in `src/app/layout.tsx`) |
| Mono font | **Geist Mono** (same loader) |

**Body font decision (locked 2026-04-28):** Brad confirmed he didn't apply a specific font to the Figma mock — he told Figma AI "basic sans serif, looks good on any device." We're already on Geist, which fits that criteria exactly: clean modern sans, designed for cross-device legibility, no extra dependency. Stay on Geist. Don't switch to system stack or Adobe Fonts — that would be churn for marginal benefit, and the mock won't match pixel-for-pixel either way.

### Dark mode (`.dark`)

Brad's Figma export didn't include a dark scheme. Our existing dark values are preserved for app surfaces. Brand tokens (`--vendcast-teal`, `--vendcast-orange`) are unchanged in dark mode.

---

## How to update tokens

### Changing a brand color (Brad refines the teal/orange)

1. Edit `--vendcast-teal` or `--vendcast-orange` in **both** `:root` and `.dark` blocks of `src/app/globals.css`.
2. `npm run check` to confirm no consumer breaks.
3. Visual on Vercel preview — the homepage's accent stripes + tints update automatically.
4. Commit, push, PR.

### Adding a new role token

1. Add the CSS variable to `:root` (and `.dark` if it should differ).
2. Add a matching `--color-foo-bar: var(--foo-bar);` line to the `@theme inline` block at the top of `globals.css`. This exposes it as `bg-foo-bar`, `text-foo-bar`, etc. in Tailwind utility classes.
3. Document in this file under the relevant section.

### Adding a new brand token (e.g., `--vendcast-yellow` if a third brand color emerges)

1. Add to `:root` + `.dark`.
2. Add a `--color-brand-yellow: var(--vendcast-yellow);` line to `@theme inline`.
3. Document in the **Brand colors** table above.

### Don't

- Don't reference Tailwind's built-in palettes (e.g. `bg-orange-500`, `text-teal-700`) in marketing or branded surfaces. Use brand tokens. Built-in palettes are fine for utility/admin/internal screens where brand identity is irrelevant.
- Don't hard-code hex values in JSX. If the value is brand-significant, add a token; if it's one-off, ask whether it should be tokenized.

---

## Reference: Brad's full Figma export (verbatim)

Captured 2026-04-27 from Brad's Figma Make HTML preview. This is the source-of-truth blob the values above are derived from. If we ever need to re-sync, this is the reference.

```css
--font-size: 16px;
--background: #fff;
--foreground: oklch(14.5% 0 0);
--card: #fff;
--card-foreground: oklch(14.5% 0 0);
--popover: oklch(100% 0 0);
--popover-foreground: oklch(14.5% 0 0);
--primary: #030213;
--primary-foreground: oklch(100% 0 0);
--secondary: oklch(95% .0058 264.53);
--secondary-foreground: #030213;
--muted: #ececf0;
--muted-foreground: #717182;
--accent: #e9ebef;
--accent-foreground: #030213;
--destructive: #d4183d;
--destructive-foreground: #fff;
--border: #0000001a;
--input: transparent;
--input-background: #f3f3f5;
--switch-background: #cbced4;
--font-weight-medium: 500;
--font-weight-normal: 400;
--ring: oklch(70.8% 0 0);
--chart-1: oklch(64.6% .222 41.116);
--chart-2: oklch(60% .118 184.704);
--chart-3: oklch(39.8% .07 227.392);
--chart-4: oklch(82.8% .189 84.429);
--chart-5: oklch(76.9% .188 70.08);
--radius: .625rem;
--sidebar: oklch(98.5% 0 0);
--sidebar-foreground: oklch(14.5% 0 0);
--sidebar-primary: #030213;
--sidebar-primary-foreground: oklch(98.5% 0 0);
--sidebar-accent: oklch(97% 0 0);
--sidebar-accent-foreground: oklch(20.5% 0 0);
--sidebar-border: oklch(92.2% 0 0);
--sidebar-ring: oklch(70.8% 0 0);
--vendcast-orange: #e8621a;
--vendcast-teal: #0d4f5c;
```

---

## Phase rollout (where this is going next)

1. **Phase 1 (this PR):** brand tokens land in `globals.css` + homepage uses them for accent stripes/tints. OG image colors swap to brand. ✅
2. **Phase 1.5 (deferred):** full-bleed teal hero band on homepage to match Brad's Figma exactly. Structural change, separate PR.
3. **Phase 2:** roll out to other marketing pages — `/pricing` (when shipped), `/roadmap`, `/contact`, `/help`, `/follow`, `/book`.
4. **Phase 3:** auth pages — `/login`, `/signup`.
5. **Phase 4:** dashboard surfaces — multi-session, divides cleanly into sub-PRs.
6. **Phase 5:** admin polish.
