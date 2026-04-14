import type { Metadata } from "next";
export const metadata: Metadata = { title: "Discover" };

import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Compass, TrendingUp, Users, Lock, BarChart3 } from "lucide-react";

export default async function DiscoverPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return null;
  }

  // Check subscription tier — Pro/Premium only
  const { data: profile } = await supabase
    .from("profiles")
    .select("subscription_tier")
    .eq("id", user.id)
    .single();

  const tier = profile?.subscription_tier ?? "starter";
  const isPro = tier === "pro" || tier === "premium";

  if (!isPro) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold">Discover</h1>
          <p className="text-muted-foreground">Events performing well for operators like you</p>
        </div>

        <div className="rounded-xl border bg-card p-10 text-center space-y-4 max-w-lg mx-auto">
          <div className="w-14 h-14 rounded-full bg-muted flex items-center justify-center mx-auto">
            <Lock className="h-6 w-6 text-muted-foreground" />
          </div>
          <div>
            <p className="text-lg font-semibold">Discover is a Pro feature</p>
            <p className="text-sm text-muted-foreground mt-2">
              See which events are performing well for similar food truck operators — ranked by average revenue, filtered to events you haven&apos;t tried yet.
            </p>
          </div>
          <Link href="/dashboard/upgrade">
            <Button className="mt-2">Upgrade to Pro</Button>
          </Link>
        </div>
      </div>
    );
  }

  // Use service role client for cross-user query
  const serviceSupabase = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  // Get the current user's event names (to exclude from recommendations)
  const { data: myEvents } = await supabase
    .from("events")
    .select("event_name")
    .eq("user_id", user.id);

  const myEventNames = new Set(
    (myEvents ?? []).map((e) => e.event_name.toLowerCase().trim())
  );

  // Get event_performance records from users who have data sharing enabled
  // Join through profiles table to filter data_sharing_enabled = true
  const { data: sharingProfiles } = await serviceSupabase
    .from("profiles")
    .select("id")
    .eq("data_sharing_enabled", true)
    .neq("id", user.id);

  const sharingUserIds = (sharingProfiles ?? []).map((p) => p.id);

  interface PerformanceRow {
    event_name: string;
    avg_sales: number;
    times_booked: number;
    trend: string;
    confidence: string;
    user_id: string;
  }

  let recommendations: {
    event_name: string;
    avg_sales: number;
    operator_count: number;
    times_booked_total: number;
    confidence: string;
    trend: string;
    event_types: string[];
  }[] = [];

  if (sharingUserIds.length > 0) {
    const { data: allPerf } = await serviceSupabase
      .from("event_performance")
      .select("event_name, avg_sales, times_booked, trend, confidence, user_id")
      .in("user_id", sharingUserIds)
      .gt("avg_sales", 0)
      .gte("times_booked", 2); // only include events with at least 2 bookings

    const perfs = (allPerf ?? []) as PerformanceRow[];

    // Group by event_name and aggregate
    const grouped = new Map<
      string,
      { avg_sales: number[]; times_booked: number[]; confidences: string[]; trends: string[]; operator_ids: Set<string> }
    >();

    for (const p of perfs) {
      const key = p.event_name.trim();
      // Skip events the current user has already done
      if (myEventNames.has(key.toLowerCase())) continue;

      if (!grouped.has(key)) {
        grouped.set(key, {
          avg_sales: [],
          times_booked: [],
          confidences: [],
          trends: [],
          operator_ids: new Set(),
        });
      }
      const entry = grouped.get(key)!;
      entry.avg_sales.push(p.avg_sales);
      entry.times_booked.push(p.times_booked);
      entry.confidences.push(p.confidence);
      entry.trends.push(p.trend);
      entry.operator_ids.add(p.user_id);
    }

    // Build recommendation list
    for (const [name, data] of grouped) {
      if (data.operator_ids.size < 1) continue;
      const avgSales =
        data.avg_sales.reduce((a, b) => a + b, 0) / data.avg_sales.length;
      const totalBooked = data.times_booked.reduce((a, b) => a + b, 0);

      // Pick the most common confidence level
      const confCount: Record<string, number> = {};
      for (const c of data.confidences) confCount[c] = (confCount[c] ?? 0) + 1;
      const bestConf = Object.entries(confCount).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "LOW";

      // Pick the most common trend
      const trendCount: Record<string, number> = {};
      for (const t of data.trends) trendCount[t] = (trendCount[t] ?? 0) + 1;
      const bestTrend = Object.entries(trendCount).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "Stable";

      recommendations.push({
        event_name: name,
        avg_sales: Math.round(avgSales),
        operator_count: data.operator_ids.size,
        times_booked_total: totalBooked,
        confidence: bestConf,
        trend: bestTrend,
        event_types: [],
      });
    }

    // Sort by avg_sales descending, take top 20
    recommendations = recommendations
      .sort((a, b) => b.avg_sales - a.avg_sales)
      .slice(0, 20);

    // Enrich with event types from events table
    if (recommendations.length > 0) {
      const recNames = recommendations.map((r) => r.event_name);
      const { data: eventTypeData } = await serviceSupabase
        .from("events")
        .select("event_name, event_type")
        .in("user_id", sharingUserIds)
        .in("event_name", recNames)
        .not("event_type", "is", null);

      const typeMap = new Map<string, Set<string>>();
      for (const e of eventTypeData ?? []) {
        if (!typeMap.has(e.event_name)) typeMap.set(e.event_name, new Set());
        if (e.event_type) typeMap.get(e.event_name)!.add(e.event_type);
      }

      recommendations = recommendations.map((r) => ({
        ...r,
        event_types: Array.from(typeMap.get(r.event_name) ?? []),
      }));
    }
  }

  function formatCurrency(val: number): string {
    return `$${val.toLocaleString("en-US", {
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    })}`;
  }

  const confidenceColor: Record<string, string> = {
    HIGH: "bg-green-100 text-green-800 border-green-300",
    MEDIUM: "bg-yellow-100 text-yellow-800 border-yellow-300",
    LOW: "bg-gray-100 text-gray-800 border-gray-300",
  };

  const trendColor: Record<string, string> = {
    Growing: "text-green-600",
    Declining: "text-red-600",
    Stable: "text-blue-600",
    "New/Insufficient Data": "text-gray-500",
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Discover</h1>
        <p className="text-muted-foreground">
          Events performing well for operators like you — ranked by average revenue
        </p>
      </div>

      {/* Context banner */}
      <div className="rounded-lg border border-blue-200 bg-blue-50 dark:border-blue-800/40 dark:bg-blue-950/20 px-4 py-3 text-sm text-blue-800 dark:text-blue-300 flex items-start gap-2">
        <Compass className="h-4 w-4 mt-0.5 shrink-0" />
        <span>
          These are events you haven&apos;t booked yet that perform well across other VendCast operators who opted into anonymous data sharing.
          Only showing events with real booking history.
        </span>
      </div>

      {recommendations.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center space-y-3">
            <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center mx-auto">
              <BarChart3 className="h-5 w-5 text-muted-foreground" />
            </div>
            <p className="text-sm font-medium">Not enough data yet</p>
            <p className="text-xs text-muted-foreground max-w-sm mx-auto">
              Recommendations appear when other operators using VendCast share their event performance data. Check back as the platform grows.
            </p>
            <p className="text-xs text-muted-foreground">
              You can enable your own data sharing in{" "}
              <Link href="/dashboard/settings" className="text-primary hover:underline">
                Settings
              </Link>
              {" "}to contribute — it helps the whole community.
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          <p className="text-xs text-muted-foreground">
            Showing {recommendations.length} events from {sharingUserIds.length} operator{sharingUserIds.length !== 1 ? "s" : ""} who share data
          </p>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {recommendations.map((rec) => (
              <Card key={rec.event_name} className="hover:shadow-md transition-shadow">
                <CardHeader className="pb-2">
                  <CardTitle className="text-base leading-tight">{rec.event_name}</CardTitle>
                  {rec.event_types.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1">
                      {rec.event_types.slice(0, 2).map((t) => (
                        <Badge key={t} variant="outline" className="text-xs">
                          {t}
                        </Badge>
                      ))}
                    </div>
                  )}
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex items-end justify-between">
                    <div>
                      <p className="text-2xl font-bold">{formatCurrency(rec.avg_sales)}</p>
                      <p className="text-xs text-muted-foreground">avg revenue</p>
                    </div>
                    <Badge
                      variant="outline"
                      className={`text-xs ${confidenceColor[rec.confidence] ?? ""}`}
                    >
                      {rec.confidence}
                    </Badge>
                  </div>

                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <Users className="h-3 w-3" />
                      {rec.operator_count} operator{rec.operator_count !== 1 ? "s" : ""}
                    </span>
                    <span className="flex items-center gap-1">
                      <BarChart3 className="h-3 w-3" />
                      {rec.times_booked_total} booking{rec.times_booked_total !== 1 ? "s" : ""}
                    </span>
                    <span className={`flex items-center gap-0.5 font-medium ${trendColor[rec.trend] ?? ""}`}>
                      <TrendingUp className="h-3 w-3" />
                      {rec.trend}
                    </span>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
