"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { validateSlug, suggestSlugFromName } from "@/lib/public-slug";

/**
 * Stage 2 of the custom-vendor-profile workstream.
 *
 * Stage 1 (PR #28) shipped the profiles.public_slug column + the
 * PATCH /api/profile/public-slug endpoint. This component is the
 * picker UI on /dashboard/settings's Public Schedule card.
 *
 * Stage 3 (next session) ships the public /<slug> route that
 * resolves to the operator's profile + upcoming events.
 *
 * What this component does
 *   - Live-validates the proposed slug as the operator types
 *     (lexical shape, length, reserved-list — DB uniqueness is
 *     checked server-side on save)
 *   - Offers a "suggest from business name" affordance that
 *     normalizes their existing business_name through
 *     suggestSlugFromName() — the same helper /api uses
 *   - Renders a live URL preview so the operator sees what they're
 *     committing to before clicking Save
 *   - Allows clearing the slug (sends `null` to the endpoint)
 *
 * Design notes
 *   - Validation is intentionally generous mid-typing: when the
 *     input is empty or shorter than the minimum, the helper text
 *     reads as instructional ("3-40 lowercase letters…") rather
 *     than an error. Errors only render when the input has at
 *     least 3 chars AND fails validation — avoids screaming at
 *     the operator while they're still typing.
 *   - "Save" is disabled until the input is BOTH valid AND
 *     different from the currently-saved slug. Prevents busy-
 *     work writes.
 *   - 409 from the API is treated as a soft validation error
 *     (someone else has it) and surfaces inline.
 */

interface PublicSlugPickerProps {
  initialSlug: string | null;
  businessName: string | null;
  onSaved?: (slug: string | null) => void;
}

export function PublicSlugPicker({
  initialSlug,
  businessName,
  onSaved,
}: PublicSlugPickerProps) {
  const [savedSlug, setSavedSlug] = useState<string | null>(initialSlug);
  const [draft, setDraft] = useState<string>(initialSlug ?? "");
  const [saving, setSaving] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [savedJustNow, setSavedJustNow] = useState(false);

  // Derived validation state — runs every keystroke. Cheap (regex +
  // set lookup); no debounce needed for client-side checks.
  const validation = useMemo(() => {
    if (!draft.trim()) return { ok: false, reason: null as string | null };
    if (draft.trim().length < 3) {
      // Don't error mid-typing — show instructional helper instead.
      return { ok: false, reason: null };
    }
    const result = validateSlug(draft);
    return { ok: result.ok, reason: result.ok ? null : result.reason };
  }, [draft]);

  const isUnchanged = (savedSlug ?? "") === draft.trim().toLowerCase();
  const canSave = validation.ok && !isUnchanged && !saving;
  const canClear = savedSlug !== null && !saving;

  function buildPreviewUrl(slug: string): string {
    const origin =
      typeof window !== "undefined" ? window.location.origin : "https://vendcast.co";
    return `${origin}/${slug}`;
  }

  async function handleSave() {
    if (!validation.ok) return;
    setSaving(true);
    setServerError(null);
    setSavedJustNow(false);
    try {
      const res = await fetch("/api/profile/public-slug", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ public_slug: draft.trim().toLowerCase() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setServerError(data.error ?? "Couldn't save slug — try again");
        setSaving(false);
        return;
      }
      const next = (data.public_slug as string | null) ?? null;
      setSavedSlug(next);
      setDraft(next ?? "");
      setSavedJustNow(true);
      onSaved?.(next);
    } catch {
      setServerError("Network error — check your connection and try again");
    }
    setSaving(false);
  }

  async function handleClear() {
    if (!confirm("Clear your custom URL? Your schedule will fall back to the UUID-based link.")) {
      return;
    }
    setSaving(true);
    setServerError(null);
    setSavedJustNow(false);
    try {
      const res = await fetch("/api/profile/public-slug", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ public_slug: null }),
      });
      const data = await res.json();
      if (!res.ok) {
        setServerError(data.error ?? "Couldn't clear slug — try again");
        setSaving(false);
        return;
      }
      setSavedSlug(null);
      setDraft("");
      setSavedJustNow(true);
      onSaved?.(null);
    } catch {
      setServerError("Network error — check your connection and try again");
    }
    setSaving(false);
  }

  function handleSuggest() {
    const suggested = suggestSlugFromName(businessName);
    if (suggested) {
      setDraft(suggested);
      setServerError(null);
      setSavedJustNow(false);
    } else {
      setServerError(
        "Couldn't suggest a slug from your business name — type one manually below."
      );
    }
  }

  return (
    <div className="space-y-3">
      {savedSlug && (
        <div className="rounded-md border border-brand-teal/20 bg-brand-teal/5 px-3 py-2 text-sm">
          <p className="font-medium text-foreground">Your custom URL:</p>
          <code
            data-testid="public-slug-current-url"
            className="mt-1 block break-all text-brand-teal"
          >
            {buildPreviewUrl(savedSlug)}
          </code>
        </div>
      )}

      <div className="space-y-1">
        <Label htmlFor="public-slug-input">
          {savedSlug ? "Change your custom URL" : "Pick a custom URL"}
        </Label>
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground whitespace-nowrap">
            vendcast.co/
          </span>
          <Input
            id="public-slug-input"
            data-testid="public-slug-input"
            type="text"
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
              setServerError(null);
              setSavedJustNow(false);
            }}
            placeholder={businessName ? suggestSlugFromName(businessName) ?? "your-truck" : "your-truck"}
            spellCheck={false}
            autoCapitalize="none"
            autoCorrect="off"
            className="flex-1"
          />
        </div>

        {/* Helper text. Switches between instructional / error /
            success based on validation + server response. */}
        {serverError ? (
          <p
            data-testid="public-slug-error"
            className="text-xs text-destructive"
          >
            {serverError}
          </p>
        ) : savedJustNow ? (
          <p className="text-xs text-green-600">Saved.</p>
        ) : validation.reason ? (
          <p data-testid="public-slug-validation" className="text-xs text-destructive">
            {validation.reason}
          </p>
        ) : (
          <p className="text-xs text-muted-foreground">
            3–40 lowercase letters, numbers, single hyphens. Must start with a letter.
          </p>
        )}

        {draft.trim().length >= 3 && validation.ok && !isUnchanged && (
          <p className="text-xs text-muted-foreground">
            Preview:{" "}
            <code className="text-foreground">
              {buildPreviewUrl(draft.trim().toLowerCase())}
            </code>
          </p>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          onClick={handleSave}
          disabled={!canSave}
          data-testid="public-slug-save"
        >
          {saving ? "Saving…" : savedSlug ? "Update URL" : "Save URL"}
        </Button>
        {businessName && (
          <Button
            size="sm"
            variant="outline"
            onClick={handleSuggest}
            disabled={saving}
            data-testid="public-slug-suggest"
          >
            Suggest from business name
          </Button>
        )}
        {savedSlug && (
          <Button
            size="sm"
            variant="ghost"
            onClick={handleClear}
            disabled={!canClear}
            data-testid="public-slug-clear"
          >
            Clear
          </Button>
        )}
      </div>
    </div>
  );
}
