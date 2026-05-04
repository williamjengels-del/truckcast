"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ArrowRight, AlertCircle, Loader2, Trash2 } from "lucide-react";

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
