"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RefreshCw, CheckCircle, Trash2 } from "lucide-react";

const adminNavItems = [
  { href: "/dashboard/admin", label: "Overview" },
  { href: "/dashboard/admin/users", label: "Users", active: true },
  { href: "/dashboard/admin/data", label: "Event Data" },
  { href: "/dashboard/admin/beta", label: "Invites" },
  { href: "/dashboard/admin/feedback", label: "Feedback" },
  { href: "/dashboard/admin/content", label: "Content" },
];

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
}

const TIER_COLORS: Record<string, string> = {
  starter: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300",
  pro: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
  premium: "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400",
};

export default function AdminUsersPage() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [extending, setExtending] = useState<string | null>(null);

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

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold">Users</h1>
          <p className="text-sm text-muted-foreground">
            {totalUsers} total · {byTier.starter ?? 0} Starter · {byTier.pro ?? 0} Pro · {byTier.premium ?? 0} Premium
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={load} disabled={loading}>
          <RefreshCw className="h-4 w-4 mr-2" />
          Refresh
        </Button>
      </div>

      {/* Admin nav */}
      <div className="flex gap-1 border-b pb-0 -mb-2 overflow-x-auto">
        {adminNavItems.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
              item.active
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground hover:border-muted-foreground"
            }`}
          >
            {item.label}
          </Link>
        ))}
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
            <p className="text-2xl font-bold text-green-600">{onboardingDone}</p>
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
                ) : users.length === 0 ? (
                  <tr><td colSpan={11} className="text-center p-8 text-muted-foreground">No users found.</td></tr>
                ) : (
                  users.map((user) => (
                    <tr key={user.id} className="border-b last:border-0 hover:bg-muted/30">
                      <td className="p-3">
                        <div className="font-medium">{user.business_name ?? <span className="text-muted-foreground italic">Unnamed</span>}</div>
                        {!user.onboarding_completed && (
                          <span className="text-xs text-amber-600">Onboarding incomplete</span>
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
                        <span className={user.booked_count > 0 ? "text-green-600 font-medium" : "text-muted-foreground"}>
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
                        <div className="flex items-center gap-1.5">
                          {user.data_sharing_enabled ? (
                            <Badge className="bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400 border-0 text-xs">Sharing</Badge>
                          ) : (
                            <Badge variant="outline" className="text-xs text-muted-foreground">Opted out</Badge>
                          )}
                          {user.stripe_customer_id && (
                            <Badge variant="outline" className="text-xs text-blue-600 border-blue-200">Stripe</Badge>
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
                          {saved === user.id && <CheckCircle className="h-4 w-4 text-green-500 shrink-0" />}
                        </div>
                      </td>
                      <td className="p-3 text-xs text-muted-foreground whitespace-nowrap">
                        {new Date(user.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                      </td>
                      <td className="p-3">
                        <div className="flex items-center gap-1">
                          {!user.stripe_subscription_id && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 px-2 text-xs text-muted-foreground hover:text-blue-600"
                              disabled={extending === user.id}
                              title={user.trial_extended_until ? `Extended until ${new Date(user.trial_extended_until).toLocaleDateString()}` : "Extend trial period"}
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
