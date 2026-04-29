"use client";

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Legend,
  Cell,
} from "recharts";

// Branded categorical palette — leads with brand-orange + brand-teal,
// then chart-2/3/4/5 hex equivalents from globals.css oklch tokens,
// then tints for the longer-tail event-type slices. Hex literals
// because Recharts ignores CSS vars on <Cell>.
const COLORS = [
  "#e8621a", // brand-orange
  "#0d4f5c", // brand-teal
  "#2c8a8c", // chart-2 mid teal
  "#ddb043", // chart-4 yellow-gold
  "#d6a358", // chart-5 gold
  "#1f4756", // chart-3 deep teal
  "#f4b08c", // brand-orange tint
  "#5a9ea0", // teal tint
  "#a3623d", // burnt orange
  "#3a7a82", // teal-aqua
  "#c8915c", // muted gold
  "#7a4623", // dark orange
];

const FEE_COLORS: Record<string, string> = {
  none: "#0d4f5c",
  flat_fee: "#e8621a",
  percentage: "#eab308",
  commission_with_minimum: "#f97316",
  pre_settled: "#9333ea",
};

function formatLabel(feeType: string): string {
  return feeType
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

export interface MonthlyTrendData {
  month: string;
  monthLabel: string;
  revenue: number;
  events: number;
  avgRevenue: number;
}

export interface QuarterData {
  quarter: string;
  revenue: number;
  events: number;
  avgRevenue: number;
}

export interface WeekendVsWeekdayData {
  label: string;
  revenue: number;
  events: number;
  avgRevenue: number;
}

export interface FeeImpactData {
  feeType: string;
  label: string;
  totalRevenue: number;
  avgNetSales: number;
  totalFees: number;
  events: number;
}

export function SeasonalTrendsCharts({
  monthlyTrend,
  quarterData,
  weekendVsWeekday,
}: {
  monthlyTrend: MonthlyTrendData[];
  quarterData: QuarterData[];
  weekendVsWeekday: WeekendVsWeekdayData[];
}) {
  const hasData = monthlyTrend.some((d) => d.revenue > 0);

  if (!hasData) {
    return (
      <div className="h-32 flex items-center justify-center text-muted-foreground">
        Not enough data yet. Complete events with sales to see seasonal trends.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Monthly Revenue by Month of Year */}
      <div>
        <h3 className="text-sm font-medium text-muted-foreground mb-3">
          Average Revenue by Month
        </h3>
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0}>
            <BarChart data={monthlyTrend}>
              <XAxis dataKey="monthLabel" fontSize={12} />
              <YAxis
                fontSize={12}
                tickFormatter={(v: number) =>
                  v >= 1000 ? `$${(v / 1000).toFixed(0)}k` : `$${v}`
                }
              />
              <Tooltip
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                formatter={(value: any, name: any) => [
                  `$${Number(value).toLocaleString()}`,
                  name === "avgRevenue" ? "Avg Revenue" : name,
                ]}
                labelFormatter={(label) => label}
              />
              <Bar dataKey="avgRevenue" name="Avg Revenue" radius={[4, 4, 0, 0]}>
                {monthlyTrend.map((_, idx) => (
                  <Cell key={idx} fill={COLORS[idx % COLORS.length]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Quarter Breakdown */}
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <h3 className="text-sm font-medium text-muted-foreground mb-3">
            Revenue by Quarter
          </h3>
          <div className="h-48">
            <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0}>
              <BarChart data={quarterData}>
                <XAxis dataKey="quarter" fontSize={12} />
                <YAxis
                  fontSize={12}
                  tickFormatter={(v: number) =>
                    v >= 1000 ? `$${(v / 1000).toFixed(0)}k` : `$${v}`
                  }
                />
                <Tooltip
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  formatter={(value: any) => [
                    `$${Number(value).toLocaleString()}`,
                    "Revenue",
                  ]}
                />
                <Bar dataKey="revenue" name="Revenue" fill="#e8621a" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Weekend vs Weekday */}
        <div>
          <h3 className="text-sm font-medium text-muted-foreground mb-3">
            Weekend vs Weekday
          </h3>
          <div className="h-48">
            <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0}>
              <BarChart data={weekendVsWeekday}>
                <XAxis dataKey="label" fontSize={12} />
                <YAxis
                  fontSize={12}
                  tickFormatter={(v: number) =>
                    v >= 1000 ? `$${(v / 1000).toFixed(0)}k` : `$${v}`
                  }
                />
                <Tooltip
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  formatter={(value: any, name: any) => [
                    `$${Number(value).toLocaleString()}`,
                    name === "avgRevenue" ? "Avg Revenue" : "Total Revenue",
                  ]}
                />
                <Legend />
                <Bar
                  dataKey="revenue"
                  name="Total Revenue"
                  fill="#e8621a"
                  radius={[4, 4, 0, 0]}
                />
                <Bar
                  dataKey="avgRevenue"
                  name="Avg Revenue"
                  fill="#0d4f5c"
                  radius={[4, 4, 0, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </div>
  );
}

export function FeeImpactChart({
  feeImpact,
}: {
  feeImpact: FeeImpactData[];
}) {
  if (feeImpact.length === 0) {
    return (
      <div className="h-32 flex items-center justify-center text-muted-foreground">
        Not enough data yet. Complete events with different fee types to see fee
        impact analysis.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2">
        {/* Revenue by Fee Type */}
        <div>
          <h3 className="text-sm font-medium text-muted-foreground mb-3">
            Total Revenue by Fee Type
          </h3>
          <div className="h-48">
            <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0}>
              <BarChart data={feeImpact}>
                <XAxis dataKey="label" fontSize={11} />
                <YAxis
                  fontSize={12}
                  tickFormatter={(v: number) =>
                    v >= 1000 ? `$${(v / 1000).toFixed(0)}k` : `$${v}`
                  }
                />
                <Tooltip
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  formatter={(value: any) => [
                    `$${Number(value).toLocaleString()}`,
                    "Revenue",
                  ]}
                />
                <Bar dataKey="totalRevenue" name="Revenue" radius={[4, 4, 0, 0]}>
                  {feeImpact.map((d) => (
                    <Cell
                      key={d.feeType}
                      fill={FEE_COLORS[d.feeType] ?? "#6b7280"}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Avg Net Sales by Fee Type */}
        <div>
          <h3 className="text-sm font-medium text-muted-foreground mb-3">
            Average Net Sales by Fee Type
          </h3>
          <div className="h-48">
            <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0}>
              <BarChart data={feeImpact}>
                <XAxis dataKey="label" fontSize={11} />
                <YAxis
                  fontSize={12}
                  tickFormatter={(v: number) =>
                    v >= 1000 ? `$${(v / 1000).toFixed(0)}k` : `$${v}`
                  }
                />
                <Tooltip
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  formatter={(value: any) => [
                    `$${Number(value).toLocaleString()}`,
                    "Avg Net Sales",
                  ]}
                />
                <Bar
                  dataKey="avgNetSales"
                  name="Avg Net Sales"
                  radius={[4, 4, 0, 0]}
                >
                  {feeImpact.map((d) => (
                    <Cell
                      key={d.feeType}
                      fill={FEE_COLORS[d.feeType] ?? "#6b7280"}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Summary Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {feeImpact.map((d) => (
          <div
            key={d.feeType}
            className="rounded-lg border p-3 text-center space-y-1"
          >
            <p className="text-xs text-muted-foreground">{d.label}</p>
            <p className="text-lg font-semibold">
              {d.events} event{d.events !== 1 ? "s" : ""}
            </p>
            <p className="text-xs text-muted-foreground">
              Fees paid: ${d.totalFees.toLocaleString()}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
