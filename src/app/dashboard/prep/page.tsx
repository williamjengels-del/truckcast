"use client";

import { useEffect, useState } from "react";
import { useImpersonation } from "@/components/impersonation-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Trash2, Plus, X } from "lucide-react";

// /dashboard/prep
//
// Three shared kitchen-state lists: On hand / To prep / To get. Free-
// text inputs, tap-to-done, swipe-style delete. Visible to the owner
// always; visible to managers only when their team_members.prep_access
// is true (RLS + canAccessPrep guard combined; nav also hides the
// entry).
//
// Deliberately minimal in v1:
//   - No quantities-as-numbers / unit conversion
//   - No categories within sections
//   - No recipes, par levels, vendor orders, costing
//   - No per-event linkage
// Evolves from here.

type Section = "on_hand" | "to_prep" | "to_buy";

interface PrepItem {
  id: string;
  section: Section;
  text: string;
  done: boolean;
  created_at: string;
  updated_at: string;
  done_at: string | null;
  created_by: string | null;
  done_by: string | null;
}

interface SectionConfig {
  key: Section;
  title: string;
  placeholder: string;
  blurb: string;
}

const SECTIONS: SectionConfig[] = [
  {
    key: "on_hand",
    title: "On hand",
    placeholder: "e.g. 20 lbs ground beef",
    blurb: "What's in the truck or commissary right now.",
  },
  {
    key: "to_prep",
    title: "To prep",
    placeholder: "e.g. salsa, 2 gallons",
    blurb: "What needs to be cooked, portioned, or assembled.",
  },
  {
    key: "to_buy",
    title: "To get",
    placeholder: "e.g. propane, more cilantro",
    blurb: "Shopping list — pickup, delivery, or supplier order.",
  },
];

export default function PrepPage() {
  const { effectiveUserId } = useImpersonation();
  const [items, setItems] = useState<PrepItem[]>([]);
  const [loading, setLoading] = useState(true);
  // Split error state. `loadError` is fatal (replaces the page; user
  // sees a retry button). `actionError` is a single failed mutation
  // (renders inline above the lists, dismissible). Without the split,
  // one failed Add/Toggle/Delete click would replace the whole page
  // with an error screen and the operator would lose their lists from
  // a transient network hiccup.
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [showDone, setShowDone] = useState(false);

  // Initial + post-mutation list reload. Inline async closure inside
  // useEffect mirrors the pattern used in sidebar.tsx / mobile-nav.tsx —
  // setState inside the awaited promise is not considered "set-state
  // synchronously in effect," so the lint rule is satisfied.
  async function load() {
    setLoadError(null);
    try {
      const res = await fetch("/api/prep");
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setLoadError(body.error ?? `Failed to load (HTTP ${res.status})`);
        setLoading(false);
        return;
      }
      const data = (await res.json()) as { items: PrepItem[] };
      setItems(data.items);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Network error");
    }
    setLoading(false);
  }

  useEffect(() => {
    // load() is async; setState happens after an awaited fetch, not
    // inside the synchronous effect body. Same disable as mobile-nav.tsx
    // and other surfaces that do an initial-data-fetch on mount.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [effectiveUserId]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground">
        Loading...
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="space-y-4">
        <div>
          <h1 className="text-2xl font-bold">Prep</h1>
        </div>
        <Card>
          <CardContent className="py-6 space-y-3">
            <p className="text-sm text-destructive">{loadError}</p>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setLoading(true);
                load();
              }}
            >
              Try again
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold">Prep</h1>
          <p className="text-muted-foreground text-sm">
            What you have on hand, what to prep, what to get.
          </p>
        </div>
        <label className="flex items-center gap-2 text-sm text-muted-foreground cursor-pointer">
          <Checkbox
            checked={showDone}
            onCheckedChange={(v) => setShowDone(v === true)}
          />
          Show completed
        </label>
      </div>

      {actionError && (
        <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive flex items-start gap-2">
          <span className="flex-1">{actionError}</span>
          <button
            type="button"
            onClick={() => setActionError(null)}
            aria-label="Dismiss"
            className="text-destructive/70 hover:text-destructive"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {SECTIONS.map((s) => (
          <SectionCard
            key={s.key}
            config={s}
            items={items.filter((i) => i.section === s.key)}
            showDone={showDone}
            onChange={load}
            onError={setActionError}
          />
        ))}
      </div>
    </div>
  );
}

function SectionCard({
  config,
  items,
  showDone,
  onChange,
  onError,
}: {
  config: SectionConfig;
  items: PrepItem[];
  showDone: boolean;
  onChange: () => void;
  onError: (m: string) => void;
}) {
  const [text, setText] = useState("");
  const [adding, setAdding] = useState(false);
  // Track which item ids are mid-flight so the row can disable
  // interactions without a full-page lock. One Set keyed by item id
  // covers both toggle + delete since each row only does one at a time.
  const [busy, setBusy] = useState<Set<string>>(new Set());

  const open = items.filter((i) => !i.done);
  const done = items.filter((i) => i.done);
  const visible = showDone ? [...open, ...done] : open;

  function markBusy(id: string, on: boolean) {
    setBusy((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = text.trim();
    if (!trimmed) return;
    setAdding(true);
    try {
      const res = await fetch("/api/prep", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ section: config.key, text: trimmed }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        onError(body.error ?? "Failed to add");
      } else {
        setText("");
        onChange();
      }
    } catch (err) {
      onError(err instanceof Error ? err.message : "Network error");
    }
    setAdding(false);
  }

  async function handleToggle(item: PrepItem) {
    markBusy(item.id, true);
    try {
      const res = await fetch("/api/prep", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: item.id, done: !item.done }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        onError(body.error ?? "Failed to update");
      } else {
        onChange();
      }
    } catch (err) {
      onError(err instanceof Error ? err.message : "Network error");
    }
    markBusy(item.id, false);
  }

  async function handleDelete(item: PrepItem) {
    markBusy(item.id, true);
    try {
      const res = await fetch("/api/prep", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: item.id }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        onError(body.error ?? "Failed to delete");
      } else {
        onChange();
      }
    } catch (err) {
      onError(err instanceof Error ? err.message : "Network error");
    }
    markBusy(item.id, false);
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">
          {config.title}
          <span className="ml-2 text-xs font-normal text-muted-foreground">
            {open.length}
          </span>
        </CardTitle>
        <p className="text-xs text-muted-foreground">{config.blurb}</p>
      </CardHeader>
      <CardContent className="space-y-3">
        <form onSubmit={handleAdd} className="flex gap-2">
          <Input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={config.placeholder}
            maxLength={500}
            className="flex-1"
            disabled={adding}
          />
          <Button
            type="submit"
            size="sm"
            disabled={adding || !text.trim()}
            aria-label={`Add to ${config.title}`}
          >
            <Plus className="h-4 w-4" />
          </Button>
        </form>
        {visible.length === 0 ? (
          <p className="text-sm text-muted-foreground py-2">
            Nothing here yet.
          </p>
        ) : (
          <ul className="space-y-1">
            {visible.map((item) => (
              <li
                key={item.id}
                className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-muted/40 group"
              >
                <Checkbox
                  checked={item.done}
                  disabled={busy.has(item.id)}
                  onCheckedChange={() => handleToggle(item)}
                  aria-label={item.done ? "Mark not done" : "Mark done"}
                />
                <span
                  className={
                    "flex-1 text-sm break-words " +
                    (item.done
                      ? "line-through text-muted-foreground"
                      : "text-foreground")
                  }
                >
                  {item.text}
                </span>
                <button
                  type="button"
                  onClick={() => handleDelete(item)}
                  disabled={busy.has(item.id)}
                  className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 text-muted-foreground hover:text-destructive transition-opacity disabled:opacity-30"
                  aria-label="Delete"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
