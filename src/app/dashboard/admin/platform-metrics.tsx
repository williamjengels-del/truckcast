"use client";

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

// Small ops-visibility charts on the admin overview. Deliberately
// minimal — this is platform pulse for Julian, not an analytics
// product. No MRR / churn / cohort / retention curves; those live in
// Stripe or a future dedicated analytics page.
//
// Data shape: each daily series is a padded 30-element array where
// every day in the last 30 days (inclusive) has an entry, even if the
// count is 0. The server fills gaps so the chart shows empty days
// rather than collapsing them. Date field is ISO YYYY-MM-DD — the
// client formats for axis display.

export interface DailyPoint {
  /** ISO date YYYY-MM-DD */
  date: string;
  count: number;
}

interface Props {
  signupsPerDay: DailyPoint[];
  eventsPerDay: DailyPoint[];
  activeUsers7d: number;
  totalSignupsIn30d: number;
  totalEventsLoggedIn30d: number;
}

function shortDate(iso: string): string {
  // "2026-04-19" → "Apr 19"
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function TinyBarChart({
  data,
  color,
}: {
  data: DailyPoint[];
  color: string;
}) {
  // Fixed-height parent + RC with 100% dims + minWidth/minHeight=0 mirrors
  // the pattern used by every other chart in this app. Without the explicit
  // parent height, Recharts 3 + React 19 concurrent hydration can measure
  // a 0-px parent before the first ResizeObserver callback and fire
  // "width(-1) and height(-1) of chart should be greater than 0" warnings
  // in the console. Harmless (the chart sizes correctly after mount) but
  // noisy. v11 deferred-cleanup item.
  return (
    <div className="h-[140px] w-full">
      <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0}>
        <BarChart data={data} margin={{ top: 8, right: 8, left: -24, bottom: 0 }}>
          <XAxis
            dataKey="date"
            tickFormatter={shortDate}
            tick={{ fontSize: 10, fill: "currentColor", opacity: 0.6 }}
            // Only show every ~5th tick so labels don't pile up.
            interval={Math.ceil(data.length / 6)}
            tickLine={false}
            axisLine={{ stroke: "currentColor", opacity: 0.1 }}
          />
          <YAxis
            allowDecimals={false}
            tick={{ fontSize: 10, fill: "currentColor", opacity: 0.6 }}
            tickLine={false}
            axisLine={false}
            width={28}
          />
          <Tooltip
            cursor={{ fill: "currentColor", opacity: 0.05 }}
            contentStyle={{
              fontSize: 12,
              background: "var(--card)",
              border: "1px solid var(--border)",
              borderRadius: 6,
            }}
            labelFormatter={(v) => shortDate(String(v))}
          />
          <Bar dataKey="count" fill={color} radius={[3, 3, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function PlatformMetrics({
  signupsPerDay,
  eventsPerDay,
  activeUsers7d,
  totalSignupsIn30d,
  totalEventsLoggedIn30d,
}: Props) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Platform activity</CardTitle>
        <p className="text-xs text-muted-foreground">
          Last 30 days unless noted. Ops visibility only.
        </p>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Headline stats */}
        <div className="grid grid-cols-3 gap-3">
          <div>
            <div className="text-xs text-muted-foreground uppercase tracking-wide">
              Signups (30d)
            </div>
            <div className="text-2xl font-bold">{totalSignupsIn30d}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground uppercase tracking-wide">
              Events logged (30d)
            </div>
            <div className="text-2xl font-bold">
              {totalEventsLoggedIn30d.toLocaleString()}
            </div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground uppercase tracking-wide">
              Active users (7d)
            </div>
            <div className="text-2xl font-bold text-primary">
              {activeUsers7d}
            </div>
            <div className="text-[10px] text-muted-foreground mt-0.5">
              signed in within 7 days
            </div>
          </div>
        </div>

        {/* Charts — side by side on md+, stacked on sm */}
        <div className="grid gap-6 md:grid-cols-2">
          <div>
            <div className="text-xs font-medium text-muted-foreground mb-1">
              Signups per day
            </div>
            <TinyBarChart data={signupsPerDay} color="#f97316" />
          </div>
          <div>
            <div className="text-xs font-medium text-muted-foreground mb-1">
              Events logged per day
            </div>
            <TinyBarChart data={eventsPerDay} color="#6366f1" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
