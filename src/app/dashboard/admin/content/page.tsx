"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Star, Plus, Trash2, ChevronUp, ChevronDown, RefreshCw } from "lucide-react";
import type { Testimonial } from "@/lib/database.types";

const adminNavItems = [
  { href: "/dashboard/admin", label: "Overview" },
  { href: "/dashboard/admin/users", label: "Users" },
  { href: "/dashboard/admin/data", label: "Event Data" },
  { href: "/dashboard/admin/beta", label: "Invites" },
  { href: "/dashboard/admin/feedback", label: "Feedback" },
  { href: "/dashboard/admin/content", label: "Content", active: true },
];

export default function AdminContentPage() {
  const [testimonials, setTestimonials] = useState<Testimonial[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const [newAuthor, setNewAuthor] = useState("");
  const [newTitle, setNewTitle] = useState("");
  const [newContent, setNewContent] = useState("");
  const [newRating, setNewRating] = useState(5);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const res = await fetch("/api/admin/testimonials");
    if (res.ok) {
      const data = await res.json();
      setTestimonials(data.testimonials ?? []);
    } else {
      setError("Failed to load testimonials");
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  async function handleAdd() {
    if (!newAuthor.trim() || !newContent.trim()) return;
    setSaving(true);
    setError(null);

    const maxOrder = testimonials.reduce((m, t) => Math.max(m, t.display_order), -1);

    const res = await fetch("/api/admin/testimonials", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        author_name: newAuthor.trim(),
        author_title: newTitle.trim() || null,
        content: newContent.trim(),
        rating: newRating,
        display_order: maxOrder + 1,
      }),
    });

    setSaving(false);
    if (res.ok) {
      setNewAuthor("");
      setNewTitle("");
      setNewContent("");
      setNewRating(5);
      setShowAddForm(false);
      setSuccessMsg("Testimonial added.");
      setTimeout(() => setSuccessMsg(null), 3000);
      await load();
    } else {
      const data = await res.json();
      setError(data.error ?? "Failed to add testimonial");
    }
  }

  async function handleToggleActive(t: Testimonial) {
    const res = await fetch(`/api/admin/testimonials/${t.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ is_active: !t.is_active }),
    });
    if (res.ok) {
      await load();
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("Delete this testimonial?")) return;
    const res = await fetch(`/api/admin/testimonials/${id}`, { method: "DELETE" });
    if (res.ok) {
      setSuccessMsg("Deleted.");
      setTimeout(() => setSuccessMsg(null), 2000);
      await load();
    }
  }

  async function handleReorder(id: string, direction: "up" | "down") {
    const idx = testimonials.findIndex((t) => t.id === id);
    if (idx === -1) return;
    const swapIdx = direction === "up" ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= testimonials.length) return;

    const a = testimonials[idx];
    const b = testimonials[swapIdx];

    await Promise.all([
      fetch(`/api/admin/testimonials/${a.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ display_order: b.display_order }),
      }),
      fetch(`/api/admin/testimonials/${b.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ display_order: a.display_order }),
      }),
    ]);

    await load();
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Site Content</h1>
        <p className="text-sm text-muted-foreground">Manage testimonials shown on the landing page</p>
      </div>

      {/* Admin nav strip */}
      <div className="flex gap-1 border-b pb-0 -mb-2">
        {adminNavItems.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              item.active
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground hover:border-muted-foreground"
            }`}
          >
            {item.label}
          </Link>
        ))}
      </div>

      {error && (
        <div className="rounded-md bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 p-3 text-sm text-red-800 dark:text-red-200">
          {error}
        </div>
      )}
      {successMsg && (
        <div className="rounded-md bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 p-3 text-sm text-green-800 dark:text-green-200">
          {successMsg}
        </div>
      )}

      {/* Stats info */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Landing Page Stats</CardTitle>
        </CardHeader>
        <CardContent className="text-sm space-y-1 text-muted-foreground">
          <p>These are currently hardcoded in <code className="font-mono text-xs bg-muted px-1 py-0.5 rounded">src/app/page.tsx</code> and must be edited there directly:</p>
          <ul className="list-disc list-inside space-y-1 mt-2">
            <li><strong>351+</strong> — Events analyzed to build the model</li>
            <li><strong>16%</strong> — Aggregate forecast error in best year</li>
            <li><strong>59%</strong> — MAPE on high-confidence events</li>
          </ul>
        </CardContent>
      </Card>

      {/* Testimonials */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Testimonials</CardTitle>
            <div className="flex gap-2">
              <Button variant="ghost" size="icon" onClick={load} disabled={loading}>
                <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
              </Button>
              <Button size="sm" className="gap-1" onClick={() => setShowAddForm(!showAddForm)}>
                <Plus className="h-4 w-4" />
                Add
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {showAddForm && (
            <div className="rounded-md border p-4 space-y-3 bg-muted/30">
              <p className="text-sm font-medium">New Testimonial</p>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label>Author Name *</Label>
                  <Input
                    value={newAuthor}
                    onChange={(e) => setNewAuthor(e.target.value)}
                    placeholder="Julian Engels"
                  />
                </div>
                <div className="space-y-1">
                  <Label>Author Title</Label>
                  <Input
                    value={newTitle}
                    onChange={(e) => setNewTitle(e.target.value)}
                    placeholder="Owner, Wok-O Taco · St. Louis, MO"
                  />
                </div>
              </div>
              <div className="space-y-1">
                <Label>Content *</Label>
                <textarea
                  className="w-full min-h-[100px] rounded-md border border-input bg-background px-3 py-2 text-sm resize-y focus:outline-none focus:ring-2 focus:ring-ring"
                  value={newContent}
                  onChange={(e) => setNewContent(e.target.value)}
                  placeholder="What they said about TruckCast..."
                />
              </div>
              <div className="space-y-1">
                <Label>Rating</Label>
                <div className="flex gap-2 items-center">
                  {[1, 2, 3, 4, 5].map((r) => (
                    <button key={r} onClick={() => setNewRating(r)}>
                      <Star
                        className={`h-5 w-5 ${r <= newRating ? "fill-primary text-primary" : "text-muted-foreground"}`}
                      />
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex gap-2">
                <Button onClick={handleAdd} disabled={saving || !newAuthor.trim() || !newContent.trim()}>
                  {saving ? "Saving..." : "Add Testimonial"}
                </Button>
                <Button variant="outline" onClick={() => setShowAddForm(false)}>Cancel</Button>
              </div>
            </div>
          )}

          {loading ? (
            <p className="text-sm text-muted-foreground text-center py-4">Loading...</p>
          ) : testimonials.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">
              No testimonials in database. The landing page is using hardcoded testimonials.
            </p>
          ) : (
            <div className="space-y-3">
              {[...testimonials]
                .sort((a, b) => a.display_order - b.display_order)
                .map((t, idx, arr) => (
                  <div
                    key={t.id}
                    className={`rounded-md border p-4 space-y-2 ${!t.is_active ? "opacity-50" : ""}`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="flex gap-0.5 mb-1">
                          {Array.from({ length: t.rating }).map((_, j) => (
                            <Star key={j} className="h-3.5 w-3.5 fill-primary text-primary" />
                          ))}
                        </div>
                        <p className="text-sm italic text-muted-foreground">&ldquo;{t.content}&rdquo;</p>
                        <p className="text-sm font-medium mt-2">{t.author_name}</p>
                        {t.author_title && (
                          <p className="text-xs text-muted-foreground">{t.author_title}</p>
                        )}
                      </div>
                      <div className="flex flex-col gap-1 items-end shrink-0">
                        <div className="flex gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            disabled={idx === 0}
                            onClick={() => handleReorder(t.id, "up")}
                          >
                            <ChevronUp className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            disabled={idx === arr.length - 1}
                            onClick={() => handleReorder(t.id, "down")}
                          >
                            <ChevronDown className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-destructive"
                            onClick={() => handleDelete(t.id)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                        <Badge
                          variant={t.is_active ? "default" : "secondary"}
                          className="cursor-pointer text-xs"
                          onClick={() => handleToggleActive(t)}
                        >
                          {t.is_active ? "Active" : "Inactive"}
                        </Badge>
                      </div>
                    </div>
                  </div>
                ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
