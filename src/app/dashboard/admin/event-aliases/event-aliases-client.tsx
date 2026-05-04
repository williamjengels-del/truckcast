"use client";

import { useState, useEffect, useTransition, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ArrowRight, AlertCircle, Loader2, Trash2, Sparkles, X } from "lucide-react";

interface SuggestionRow {
  a: { normalized: string; display: string; operator_count: number };
  b: { normalized: string; display: string; operator_count: number };
  lev_distance: number;
  lev_ratio: number;
  jaccard: number;
  score: number;
  pair_key: string;
}

interface AliasRow {
  alias_normalized: string;
  canonical_normalized: string;
  alias_display: string;
  canonical_display: string;
  notes: string | null;
  created_at: string;
}

export function EventAliasesClient({
  initialAliases,
}: {
  initialAliases: AliasRow[];
}) {
  const router = useRouter();
  const [aliases, setAliases] = useState<AliasRow[]>(initialAliases);
  const [aliasInput, setAliasInput] = useState("");
  const [canonicalInput, setCanonicalInput] = useState("");
  const [notes, setNotes] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [deletingNorm, setDeletingNorm] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const [suggestions, setSuggestions] = useState<SuggestionRow[]>([]);
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);
  const [actingPairKey, setActingPairKey] = useState<string | null>(null);

  const loadSuggestions = useCallback(async () => {
    setSuggestionsLoading(true);
    try {
      const res = await fetch("/api/admin/event-aliases/suggestions");
      if (!res.ok) return;
      const body = (await res.json()) as { suggestions?: SuggestionRow[] };
      setSuggestions(body.suggestions ?? []);
    } finally {
      setSuggestionsLoading(false);
    }
  }, []);

  // Load suggestions on mount + after any alias mutation. We don't
  // refetch on every keystroke — running the O(n²) pairwise on each
  // input change would be wasteful.
  useEffect(() => {
    loadSuggestions();
  }, [loadSuggestions]);

  async function applySuggestion(pair: SuggestionRow) {
    // Direction rule: the bucket with FEWER operators becomes the
    // alias; the higher-count one wins as canonical (preserves the
    // larger existing aggregate). On a tie, A→B (deterministic).
    const aliasSide = pair.a.operator_count <= pair.b.operator_count ? pair.a : pair.b;
    const canonSide = aliasSide === pair.a ? pair.b : pair.a;
    setActingPairKey(pair.pair_key);
    try {
      const res = await fetch("/api/admin/event-aliases", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          alias: aliasSide.display,
          canonical: canonSide.display,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(body.error ?? `Apply failed (HTTP ${res.status})`);
        return;
      }
      await Promise.all([reload(), loadSuggestions()]);
      startTransition(() => router.refresh());
    } finally {
      setActingPairKey(null);
    }
  }

  async function dismissSuggestion(pair: SuggestionRow) {
    setActingPairKey(pair.pair_key);
    try {
      const res = await fetch("/api/admin/event-aliases/suggestions/dismiss", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ a: pair.a.normalized, b: pair.b.normalized }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        alert(body.error ?? `Dismiss failed (HTTP ${res.status})`);
        return;
      }
      await loadSuggestions();
    } finally {
      setActingPairKey(null);
    }
  }

  async function reload() {
    const res = await fetch("/api/admin/event-aliases");
    if (!res.ok) return;
    const body = (await res.json()) as { aliases?: AliasRow[] };
    setAliases(body.aliases ?? []);
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!aliasInput.trim() || !canonicalInput.trim()) return;
    setCreating(true);
    setCreateError(null);
    try {
      const res = await fetch("/api/admin/event-aliases", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          alias: aliasInput.trim(),
          canonical: canonicalInput.trim(),
          notes: notes.trim() || null,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setCreateError(body.error ?? `Create failed (HTTP ${res.status})`);
        setCreating(false);
        return;
      }
      setAliasInput("");
      setCanonicalInput("");
      setNotes("");
      await reload();
      startTransition(() => router.refresh());
    } catch (e) {
      setCreateError(e instanceof Error ? e.message : "Network error");
    } finally {
      setCreating(false);
    }
  }

  async function handleDelete(aliasNorm: string) {
    if (
      !confirm(
        `Remove alias "${aliasNorm}"? The canonical bucket will recompute and any platform_events row for the alias form will be dropped.`
      )
    ) {
      return;
    }
    setDeletingNorm(aliasNorm);
    try {
      const res = await fetch(
        `/api/admin/event-aliases?alias=${encodeURIComponent(aliasNorm)}`,
        { method: "DELETE" }
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        alert(body.error ?? `Delete failed (HTTP ${res.status})`);
        setDeletingNorm(null);
        return;
      }
      await reload();
      startTransition(() => router.refresh());
    } finally {
      setDeletingNorm(null);
    }
  }

  return (
    <div className="space-y-6">
      <Card className="border-brand-teal/30">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-brand-teal" />
            Suggested aliases
            <span className="text-xs font-normal text-muted-foreground">
              ({suggestions.length}
              {suggestionsLoading ? " · scanning…" : ""})
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <p className="px-6 pb-3 text-xs text-muted-foreground">
            Pairs of platform_events buckets that look similar by Levenshtein and token overlap. Apply rolls the lower-operator-count side into the higher-count bucket; dismiss marks the pair as not-a-match so it stops surfacing.
          </p>
          {!suggestionsLoading && suggestions.length === 0 ? (
            <p className="px-6 py-3 text-sm text-muted-foreground">
              No near-miss pairs found above the similarity threshold.
            </p>
          ) : (
            <div className="divide-y">
              {suggestions.map((s) => {
                const acting = actingPairKey === s.pair_key;
                const aliasSide =
                  s.a.operator_count <= s.b.operator_count ? s.a : s.b;
                const canonSide = aliasSide === s.a ? s.b : s.a;
                return (
                  <div
                    key={s.pair_key}
                    className="px-6 py-3 flex items-start gap-3 text-sm"
                  >
                    <div className="flex-1 min-w-0 space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium">
                          {aliasSide.display}
                        </span>
                        <span className="text-xs text-muted-foreground tabular-nums">
                          ({aliasSide.operator_count} op
                          {aliasSide.operator_count === 1 ? "" : "s"})
                        </span>
                        <ArrowRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                        <span className="font-medium text-brand-teal">
                          {canonSide.display}
                        </span>
                        <span className="text-xs text-muted-foreground tabular-nums">
                          ({canonSide.operator_count} op
                          {canonSide.operator_count === 1 ? "" : "s"})
                        </span>
                      </div>
                      <p className="text-[11px] text-muted-foreground">
                        lev {s.lev_distance} · ratio{" "}
                        {(s.lev_ratio * 100).toFixed(0)}% · jaccard{" "}
                        {(s.jaccard * 100).toFixed(0)}%
                      </p>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <Button
                        size="sm"
                        onClick={() => applySuggestion(s)}
                        disabled={acting}
                      >
                        {acting ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          "Apply"
                        )}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => dismissSuggestion(s)}
                        disabled={acting}
                        title="Mark as not-an-alias"
                      >
                        <X className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Add alias</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleCreate} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-[1fr_auto_1fr] gap-3 md:items-end">
              <div className="space-y-1.5">
                <Label htmlFor="alias-input" className="text-xs">
                  Alias (the variant typed by operators)
                </Label>
                <Input
                  id="alias-input"
                  value={aliasInput}
                  onChange={(e) => setAliasInput(e.target.value)}
                  placeholder="Saturday Farmer's Market"
                  disabled={creating}
                  required
                />
              </div>
              <div className="hidden md:flex items-center justify-center pb-2">
                <ArrowRight className="h-4 w-4 text-muted-foreground" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="canonical-input" className="text-xs">
                  Canonical (the bucket to merge into)
                </Label>
                <Input
                  id="canonical-input"
                  value={canonicalInput}
                  onChange={(e) => setCanonicalInput(e.target.value)}
                  placeholder="Saturday Farmers Market"
                  disabled={creating}
                  required
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="alias-notes" className="text-xs">
                Notes (optional — why you're aliasing)
              </Label>
              <Textarea
                id="alias-notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
                disabled={creating}
                placeholder="Apostrophe drift — same vendor's market across operators."
              />
            </div>
            {createError && (
              <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
                <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                <p>{createError}</p>
              </div>
            )}
            <div className="flex justify-end">
              <Button type="submit" disabled={creating} size="sm">
                {creating ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                    Adding…
                  </>
                ) : (
                  "Add alias"
                )}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Existing aliases ({aliases.length})
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {aliases.length === 0 ? (
            <p className="px-6 py-4 text-sm text-muted-foreground">
              No aliases yet. Add one above to map a near-miss spelling onto a canonical bucket.
            </p>
          ) : (
            <div className="divide-y">
              {aliases.map((row) => (
                <div
                  key={row.alias_normalized}
                  className="px-6 py-3 flex items-start gap-3 text-sm"
                >
                  <div className="flex-1 min-w-0 space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium">{row.alias_display}</span>
                      <ArrowRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                      <span className="font-medium text-brand-teal">
                        {row.canonical_display}
                      </span>
                    </div>
                    {row.notes && (
                      <p className="text-xs text-muted-foreground">{row.notes}</p>
                    )}
                    <p className="text-[11px] text-muted-foreground font-mono">
                      {row.alias_normalized} → {row.canonical_normalized}
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-destructive hover:text-destructive shrink-0"
                    onClick={() => handleDelete(row.alias_normalized)}
                    disabled={deletingNorm === row.alias_normalized}
                  >
                    {deletingNorm === row.alias_normalized ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Trash2 className="h-3.5 w-3.5" />
                    )}
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
