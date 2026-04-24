"use client";

import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Loader2, Search, AlertCircle, Inbox } from "lucide-react";

interface TriageRow {
  id: string;
  user_id: string;
  business_name: string | null;
  email: string | null;
  source: string;
  reported_date: string;
  net_sales: number;
  raw_subject: string | null;
  created_at: string;
}

function formatCurrency(n: number): string {
  return `$${Number(n).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function formatDate(iso: string): string {
  return new Date(iso + "T00:00:00").toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function ToastInboxClient() {
  const [payments, setPayments] = useState<TriageRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/admin/toast-unmatched", { cache: "no-store" });
        if (!res.ok) {
          const body = await res.json().catch(() => null);
          if (!cancelled) setError(body?.error ?? `Failed to load (${res.status})`);
          return;
        }
        const body = await res.json();
        if (!cancelled) setPayments(body.payments ?? []);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Aggregate per user so admin sees the operators with open queues,
  // not a flat list. Search narrows by business name, email, or amount.
  const grouped = useMemo(() => {
    if (!payments) return [];
    const q = query.trim().toLowerCase();
    const byUser = new Map<string, { user_id: string; business_name: string | null; email: string | null; rows: TriageRow[] }>();
    for (const p of payments) {
      if (q) {
        const haystack = [
          p.business_name ?? "",
          p.email ?? "",
          String(p.net_sales),
          p.reported_date,
        ]
          .join(" ")
          .toLowerCase();
        if (!haystack.includes(q)) continue;
      }
      let bucket = byUser.get(p.user_id);
      if (!bucket) {
        bucket = { user_id: p.user_id, business_name: p.business_name, email: p.email, rows: [] };
        byUser.set(p.user_id, bucket);
      }
      bucket.rows.push(p);
    }
    // Sort users by pending count descending, then alphabetically by business name.
    return [...byUser.values()].sort((a, b) => {
      if (b.rows.length !== a.rows.length) return b.rows.length - a.rows.length;
      return (a.business_name ?? "").localeCompare(b.business_name ?? "");
    });
  }, [payments, query]);

  const totalPending = payments?.length ?? 0;
  const totalAmount = useMemo(
    () => (payments ?? []).reduce((sum, p) => sum + p.net_sales, 0),
    [payments]
  );

  if (error) {
    return (
      <Card>
        <CardContent className="flex items-center gap-2 p-4 text-sm text-destructive">
          <AlertCircle className="h-4 w-4" />
          {error}
        </CardContent>
      </Card>
    );
  }

  if (payments === null) {
    return (
      <Card>
        <CardContent className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading Toast inbox across all users…
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Inbox className="h-5 w-5" />
            Toast unmatched — all users
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <Badge variant="outline">{totalPending} pending</Badge>
            <span className="text-muted-foreground">
              across {grouped.length} {grouped.length === 1 ? "operator" : "operators"}
            </span>
            <span className="text-muted-foreground">·</span>
            <span className="text-muted-foreground">
              {formatCurrency(totalAmount)} total unrouted
            </span>
          </div>
          <div className="relative max-w-sm">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Filter by business, email, date, or amount…"
              className="pl-8"
            />
          </div>
          <p className="text-xs text-muted-foreground">
            Read-only view. Routing a payment to an event is operator-intent (deposit
            vs remainder vs dismiss) — use impersonation to resolve on behalf of a
            user, or reach out directly.
          </p>
        </CardContent>
      </Card>

      {grouped.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center text-sm text-muted-foreground">
            {query
              ? "No unmatched payments match that filter."
              : "All operator Toast inboxes are clear. 🎉"}
          </CardContent>
        </Card>
      ) : (
        grouped.map((user) => (
          <Card key={user.user_id}>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">
                <div className="flex items-center gap-2 flex-wrap">
                  <span>{user.business_name ?? "Unnamed operator"}</span>
                  <Badge variant="outline">{user.rows.length}</Badge>
                  {user.email && (
                    <span className="text-xs font-normal text-muted-foreground">
                      {user.email}
                    </span>
                  )}
                </div>
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              <div className="divide-y text-sm">
                {user.rows.map((row) => (
                  <div
                    key={row.id}
                    className="flex flex-col gap-0.5 py-2 sm:flex-row sm:items-baseline sm:gap-3"
                  >
                    <span className="font-semibold tabular-nums">
                      {formatCurrency(row.net_sales)}
                    </span>
                    <span className="text-muted-foreground">
                      reported {formatDate(row.reported_date)}
                    </span>
                    <span className="text-xs text-muted-foreground sm:ml-auto">
                      landed {formatDateTime(row.created_at)}
                    </span>
                    {row.raw_subject && (
                      <span
                        className="text-xs text-muted-foreground truncate sm:max-w-[40ch]"
                        title={row.raw_subject}
                      >
                        {row.raw_subject}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        ))
      )}
    </div>
  );
}
