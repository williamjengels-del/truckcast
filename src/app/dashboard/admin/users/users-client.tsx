"use client";

import { useState, useEffect, useMemo } from "react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RefreshCw, CheckCircle, Trash2, Search } from "lucide-react";
import { formatDate } from "@/lib/format-time";

interface AdminUser {
  id: string;
  email: string | null;
  business_name: string | null;
  city: string | null;
  state: string | null;
  subscription_tier: string;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  trial_extended_until: string | null;
  data_sharing_enabled: boolean;
  onboarding_completed: boolean;
  event_count: number;
  booked_count: number;
  sales_count: number;
  last_event_date: string | null;
  created_at: string;
  last_payment_status: string | null;
  last_payment_failure_reason: string | null;
}

function isPaymentFailing(u: AdminUser): boolean {
  return u.last_payment_status === "payment_failed" || u.last_payment_status === "past_due";
}

const TIER_COLORS: Record<string, string> = {
  starter: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300",
  pro: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
  premium: "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400",
};

export function UsersClient() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [extending, setExtending] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [onlyPaymentFailing, setOnlyPaymentFailing] = useState(false);

  // Client-side filter. User base is small enough (tens to low hundreds)
  // that this runs instantly and avoids a round-trip on every keystroke.
  // Search matches business_name, email, or city — the three fields
  // someone typically has in mind when looking up a specific user.
  // The "payment failing" toggle narrows to last_payment_status in
  // ('payment_failed' | 'past_due') — uses the partial index added by
  // migration 20260424000002 on the server-count side (not this route).
  const filteredUsers = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = users;
    if (onlyPaymentFailing) list = list.filter(isPaymentFailing);
    if (!q) return list;
    return list.filter((u) => {
      const haystack = [
        u.business_name ?? "",
        u.email ?? "",
        u.city ?? "",
        u.state ?? "",
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [users, query, onlyPaymentFailing]);

  async function load() {
    setLoading(true);
    const res = await fetch("/api/admin/users");
    if (res.ok) {
      const data = await res.json();
      setUsers(data.users ?? []);
    }
    setLoading(false);
  }

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, []);

  async function handleDelete(userId: string, name: string) {
    if (!confirm(`Permanently delete "${name || "this user"}" and ALL their data? This cannot be undone.`)) return;
    setDeleting(userId);
    const res = await fetch("/api/admin/users", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId }),
    });
    if (res.ok) {
      setUsers((prev) => prev.filter((u) => u.id !== userId));
    } else {
      const data = await res.json();
      alert("Delete failed: " + (data.error ?? "Unknown error"));
    }
    setDeleting(null);
  }

  async function handleExtendTrial(userId: string, name: string) {
    const days = prompt(`Extend trial for "${name || "user"}" by how many days?`, "30");
    if (!days || isNaN(parseInt(days))) return;
    setExtending(userId);
    const res = await fetch("/api/admin/users", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId, extend_trial_days: parseInt(days) }),
    });
    if (res.ok) {
      alert(`Trial extended by ${days} days.`);
      load();
    } else {
      const data = await res.json();
      alert("Failed: " + (data.error ?? "Unknown error"));
    }
    setExtending(null);
  }

  async function handleTierChange(userId: string, tier: string) {
    setSaving(userId);
    const res = await fetch("/api/admin/users", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId, subscription_tier: tier }),
    });
    if (res.ok) {
      setUsers((prev) => prev.map((u) => u.id === userId ? { ...u, subscription_tier: tier } : u));
      setSaved(userId);
      setTimeout(() => setSaved(null), 2000);
    }
    setSaving(null);
  }

  const totalUsers = users.length;
  const byTier = users.reduce((acc, u) => {
    acc[u.subscription_tier] = (acc[u.subscription_tier] ?? 0) + 1;
    return acc;
  }, {} as Record<string, number>);
  const onboardingDone = users.filter((u) => u.onboarding_completed).length;
  const paymentFailingCount = users.filter(isPaymentFailing).length;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold">Users</h1>
          <p className="text-sm text-muted-foreground">
            {totalUsers} total · {byTier.starter ?? 0} Starter · {byTier.pro ?? 0} Pro · {byTier.premium ?? 0} Premium
            {query && ` · ${filteredUsers.length} match${filteredUsers.length === 1 ? "" : "es"}`}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative">
            <Search className="h-4 w-4 absolute left-2.5 top-2.5 text-muted-foreground pointer-events-none" />
            <Input
              type="search"
              placeholder="Search business, email, city…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="pl-8 w-64 h-9"
            />
          </div>
          <Button
            variant={onlyPaymentFailing ? "default" : "outline"}
            size="sm"
            onClick={() => setOnlyPaymentFailing((v) => !v)}
            disabled={paymentFailingCount === 0}
            title={
              paymentFailingCount === 0
                ? "No users have a failing payment right now"
                : "Show only users with payment_failed or past_due"
            }
            data-testid="admin-users-filter-payment-failing"
          >
            Payment failing{paymentFailingCount > 0 ? ` (${paymentFailingCount})` : ""}
          </Button>
          <Button variant="outline" size="sm" onClick={load} disabled={loading}>
            <RefreshCw className="h-4 w-4 mr-2" />
            Refresh
          </Button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground font-normal">Total Users</CardTitle></CardHeader>
          <CardContent><p className="text-2xl font-bold">{totalUsers}</p></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground font-normal">Onboarded</CardTitle></CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-primary">{onboardingDone}</p>
            <p className="text-xs text-muted-foreground">{totalUsers - onboardingDone} incomplete</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground font-normal">Pro / Premium</CardTitle></CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-primary">{(byTier.pro ?? 0) + (byTier.premium ?? 0)}</p>
            <p className="text-xs text-muted-foreground">paying users</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground font-normal">Starter (free/trial)</CardTitle></CardHeader>
          <CardContent><p className="text-2xl font-bold text-muted-foreground">{byTier.starter ?? 0}</p></CardContent>
        </Card>
      </div>

      {/* User table */}
      <Card>
        <CardHeader>
          <CardTitle>All Users</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="text-left p-3 font-medium">Business</th>
                  <th className="text-left p-3 font-medium">Email</th>
                  <th className="text-left p-3 font-medium">Location</th>
                  <th className="text-right p-3 font-medium">Total</th>
                  <th className="text-right p-3 font-medium">Booked</th>
                  <th className="text-right p-3 font-medium">w/ Sales</th>
                  <th className="text-left p-3 font-medium">Last Event</th>
                  <th className="text-left p-3 font-medium">Status</th>
                  <th className="text-left p-3 font-medium">Plan</th>
                  <th className="text-left p-3 font-medium">Joined</th>
                  <th className="p-3 w-10"></th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={11} className="text-center p-8 text-muted-foreground">Loading...</td></tr>
                ) : filteredUsers.length === 0 ? (
                  <tr><td colSpan={11} className="text-center p-8 text-muted-foreground">
                    {query ? `No users match "${query}"` : "No users found."}
                  </td></tr>
                ) : (
                  filteredUsers.map((user) => (
                    <tr key={user.id} className="border-b last:border-0 hover:bg-muted/30">
                      <td className="p-3">
                        <Link
                          href={`/dashboard/admin/users/${user.id}`}
                          className="font-medium hover:underline"
                        >
                          {user.business_name ?? <span className="text-muted-foreground italic">Unnamed</span>}
                        </Link>
                        {!user.onboarding_completed && (
                          <div className="text-xs text-muted-foreground">Onboarding incomplete</div>
                        )}
                      </td>
                      <td className="p-3 text-muted-foreground text-xs">
                        {user.email ?? "—"}
                      </td>
                      <td className="p-3 text-muted-foreground">
                        {[user.city, user.state].filter(Boolean).join(", ") || "—"}
                      </td>
                      <td className="p-3 text-right font-mono text-muted-foreground">
                        {user.event_count}
                      </td>
                      <td className="p-3 text-right font-mono">
                        <span className={user.booked_count > 0 ? "text-primary font-medium" : "text-muted-foreground"}>
                          {user.booked_count}
                        </span>
                      </td>
                      <td className="p-3 text-right font-mono">
                        <span className={user.sales_count > 0 ? "text-primary font-medium" : "text-muted-foreground"}>
                          {user.sales_count}
                        </span>
                      </td>
                      <td className="p-3 text-xs text-muted-foreground whitespace-nowrap">
                        {user.last_event_date
                          ? new Date(user.last_event_date + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "2-digit" })
                          : "—"}
                      </td>
                      <td className="p-3">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          {user.data_sharing_enabled ? (
                            <Badge className="bg-primary/10 text-primary border-0 text-xs">Sharing</Badge>
                          ) : (
                            <Badge variant="outline" className="text-xs text-muted-foreground">Opted out</Badge>
                          )}
                          {user.stripe_customer_id && (
                            <Badge variant="outline" className="text-xs text-muted-foreground">Stripe</Badge>
                          )}
                          {user.last_payment_status === "payment_failed" && (
                            <Badge
                              variant="outline"
                              className="text-xs border-warning/50 text-warning"
                              title={user.last_payment_failure_reason ?? undefined}
                            >
                              Payment failed
                            </Badge>
                          )}
                          {user.last_payment_status === "past_due" && (
                            <Badge
                              variant="outline"
                              className="text-xs border-destructive/50 text-destructive"
                              title={user.last_payment_failure_reason ?? undefined}
                            >
                              Past due
                            </Badge>
                          )}
                        </div>
                      </td>
                      <td className="p-3">
                        <div className="flex items-center gap-2">
                          <Select
                            value={user.subscription_tier}
                            onValueChange={(val) => { if (val) handleTierChange(user.id, val); }}
                            disabled={saving === user.id}
                          >
                            <SelectTrigger className={`w-28 h-7 text-xs border-0 ${TIER_COLORS[user.subscription_tier] ?? ""}`}>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="starter">Starter</SelectItem>
                              <SelectItem value="pro">Pro</SelectItem>
                              <SelectItem value="premium">Premium</SelectItem>
                            </SelectContent>
                          </Select>
                          {saved === user.id && <CheckCircle className="h-4 w-4 text-primary shrink-0" />}
                        </div>
                      </td>
                      <td className="p-3 text-xs text-muted-foreground whitespace-nowrap">
                        {formatDate(user.created_at)}
                      </td>
                      <td className="p-3">
                        <div className="flex items-center gap-1">
                          {!user.stripe_subscription_id && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 px-2 text-xs text-muted-foreground hover:text-primary"
                              disabled={extending === user.id}
                              title={user.trial_extended_until ? `Extended until ${formatDate(user.trial_extended_until)}` : "Extend trial period"}
                              onClick={() => handleExtendTrial(user.id, user.business_name ?? user.email ?? "")}
                            >
                              {user.trial_extended_until && new Date(user.trial_extended_until) > new Date()
                                ? "⏰"
                                : "+Trial"}
                            </Button>
                          )}
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-muted-foreground hover:text-destructive"
                            disabled={deleting === user.id}
                            onClick={() => handleDelete(user.id, user.business_name ?? user.email ?? "")}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
