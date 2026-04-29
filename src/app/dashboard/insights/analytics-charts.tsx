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

// Branded categorical palette — leads with brand-orange + brand-teal,
// then chart-2/3/4/5 hex equivalents from globals.css oklch tokens.
// Hex literals because Recharts ignores CSS vars on <Cell>.
const COLORS = [
  "#e8621a", // brand-orange
  "#0d4f5c", // brand-teal
  "#2c8a8c", // chart-2 mid teal
  "#ddb043", // chart-4 yellow-gold
  "#d6a358", // chart-5 gold
  "#1f4756", // chart-3 deep teal
  "#f4b08c", // brand-orange tint
  "#5a9ea0", // teal tint
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
                    fill="#e8621a"
                    radius={[4, 4, 0, 0]}
                  />
                  <Bar
                    dataKey="compareRevenue"
                    name={comparePeriodLabel}
                    fill="#f4b08c"
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
                    stroke="#e8621a"
                    strokeWidth={2}
                    dot={{ fill: "#e8621a", r: 4 }}
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
                  fill="#e8621a"
                  radius={[4, 4, 0, 0]}
                />
                {compareEnabled && (
                  <Bar
                    dataKey="compareRevenue"
                    name={comparePeriodLabel}
                    fill="#f4b08c"
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
                  fill="#e8621a"
                  radius={[0, 4, 4, 0]}
                />
                {compareEnabled && (
                  <Bar
                    dataKey="compareRevenue"
                    name={comparePeriodLabel}
                    fill="#f4b08c"
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
