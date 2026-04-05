"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Legend,
  CartesianGrid,
} from "recharts";

const COLORS = [
  "#2563eb",
  "#16a34a",
  "#eab308",
  "#dc2626",
  "#9333ea",
  "#06b6d4",
  "#f97316",
  "#ec4899",
];

interface TrendDataPoint {
  label: string;
  revenue: number;
  compareRevenue?: number;
}

interface DowDataPoint {
  day: string;
  revenue: number;
  count: number;
  compareRevenue?: number;
  compareCount?: number;
}

interface TypeDataPoint {
  name: string;
  revenue: number;
  compareRevenue?: number;
}

interface AnalyticsChartsProps {
  trendData: TrendDataPoint[];
  dowData: DowDataPoint[];
  typeData: TypeDataPoint[];
  compareEnabled: boolean;
  periodLabel: string;
  comparePeriodLabel: string;
}

function formatDollar(value: number): string {
  if (value >= 1000) {
    return `$${(value / 1000).toFixed(value >= 10000 ? 0 : 1)}k`;
  }
  return `$${value.toFixed(0)}`;
}

function tooltipDollar(value: number): string {
  return `$${value.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function AnalyticsCharts({
  trendData,
  dowData,
  typeData,
  compareEnabled,
  periodLabel,
  comparePeriodLabel,
}: AnalyticsChartsProps) {
  const hasTrendData = trendData.some(
    (d) => d.revenue > 0 || (d.compareRevenue ?? 0) > 0
  );
  const hasDowData = dowData.some(
    (d) => d.revenue > 0 || (d.compareRevenue ?? 0) > 0
  );
  const hasTypeData = typeData.some(
    (d) => d.revenue > 0 || (d.compareRevenue ?? 0) > 0
  );

  // For year-over-year comparison charts, compute a shared global max so both
  // periods use the same Y-axis scale — otherwise a low Year 1 would look as
  // tall as a high Year 2, which is misleading.
  const trendGlobalMax = compareEnabled
    ? Math.max(...trendData.map((d) => Math.max(d.revenue, d.compareRevenue ?? 0)), 0)
    : 0;
  const dowGlobalMax = compareEnabled
    ? Math.max(...dowData.map((d) => Math.max(d.revenue, d.compareRevenue ?? 0)), 0)
    : 0;
  const typeGlobalMax = compareEnabled
    ? Math.max(...typeData.map((d) => Math.max(d.revenue, d.compareRevenue ?? 0)), 0)
    : 0;

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {/* Revenue trend - full width */}
      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle>
            Revenue Trend
            {compareEnabled
              ? ` - ${periodLabel} vs ${comparePeriodLabel}`
              : ` - ${periodLabel}`}
          </CardTitle>
        </CardHeader>
        <CardContent className="h-80">
          {hasTrendData ? (
            <ResponsiveContainer
              width="100%"
              height="100%"
              minWidth={0}
              minHeight={0}
            >
              {compareEnabled ? (
                <BarChart data={trendData}>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                  <XAxis dataKey="label" fontSize={12} />
                  <YAxis fontSize={12} tickFormatter={formatDollar} domain={[0, trendGlobalMax > 0 ? trendGlobalMax : "auto"]} />
                  <Tooltip
                    formatter={(value) => [
                      tooltipDollar(Number(value)),
                      undefined,
                    ]}
                  />
                  <Legend />
                  <Bar
                    dataKey="revenue"
                    name={periodLabel}
                    fill="#2563eb"
                    radius={[4, 4, 0, 0]}
                  />
                  <Bar
                    dataKey="compareRevenue"
                    name={comparePeriodLabel}
                    fill="#93c5fd"
                    radius={[4, 4, 0, 0]}
                  />
                </BarChart>
              ) : (
                <LineChart data={trendData}>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                  <XAxis dataKey="label" fontSize={12} />
                  <YAxis fontSize={12} tickFormatter={formatDollar} />
                  <Tooltip
                    formatter={(value) => [
                      tooltipDollar(Number(value)),
                      "Revenue",
                    ]}
                  />
                  <Line
                    type="monotone"
                    dataKey="revenue"
                    stroke="#2563eb"
                    strokeWidth={2}
                    dot={{ fill: "#2563eb", r: 4 }}
                    activeDot={{ r: 6 }}
                  />
                </LineChart>
              )}
            </ResponsiveContainer>
          ) : (
            <div className="h-full flex items-center justify-center text-muted-foreground">
              No revenue data for this period yet.
            </div>
          )}
        </CardContent>
      </Card>

      {/* Revenue by Day of Week */}
      <Card>
        <CardHeader>
          <CardTitle>Revenue by Day of Week</CardTitle>
        </CardHeader>
        <CardContent className="h-72">
          {hasDowData ? (
            <ResponsiveContainer
              width="100%"
              height="100%"
              minWidth={0}
              minHeight={0}
            >
              <BarChart data={dowData}>
                <XAxis dataKey="day" fontSize={12} />
                <YAxis fontSize={12} tickFormatter={formatDollar} domain={compareEnabled && dowGlobalMax > 0 ? [0, dowGlobalMax] : undefined} />
                <Tooltip
                  formatter={(value) => [
                    tooltipDollar(Number(value)),
                    undefined,
                  ]}
                />
                {compareEnabled && <Legend />}
                <Bar
                  dataKey="revenue"
                  name={compareEnabled ? periodLabel : "Revenue"}
                  fill="#2563eb"
                  radius={[4, 4, 0, 0]}
                />
                {compareEnabled && (
                  <Bar
                    dataKey="compareRevenue"
                    name={comparePeriodLabel}
                    fill="#93c5fd"
                    radius={[4, 4, 0, 0]}
                  />
                )}
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-full flex items-center justify-center text-muted-foreground">
              Day of week data will appear once you add events.
            </div>
          )}
        </CardContent>
      </Card>

      {/* Revenue by Event Type */}
      <Card>
        <CardHeader>
          <CardTitle>Revenue by Event Type</CardTitle>
        </CardHeader>
        <CardContent className="h-72">
          {hasTypeData ? (
            <ResponsiveContainer
              width="100%"
              height="100%"
              minWidth={0}
              minHeight={0}
            >
              <BarChart data={typeData} layout="vertical">
                <XAxis type="number" fontSize={12} tickFormatter={formatDollar} domain={compareEnabled && typeGlobalMax > 0 ? [0, typeGlobalMax] : undefined} />
                <YAxis
                  type="category"
                  dataKey="name"
                  fontSize={11}
                  width={120}
                  tickLine={false}
                />
                <Tooltip
                  formatter={(value) => [
                    tooltipDollar(Number(value)),
                    undefined,
                  ]}
                />
                {compareEnabled && <Legend />}
                <Bar
                  dataKey="revenue"
                  name={compareEnabled ? periodLabel : "Revenue"}
                  fill="#2563eb"
                  radius={[0, 4, 4, 0]}
                />
                {compareEnabled && (
                  <Bar
                    dataKey="compareRevenue"
                    name={comparePeriodLabel}
                    fill="#93c5fd"
                    radius={[0, 4, 4, 0]}
                  />
                )}
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-full flex items-center justify-center text-muted-foreground">
              Event type breakdown will appear once you add events.
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
