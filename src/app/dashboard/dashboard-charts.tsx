"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Legend,
  PieChart,
  Pie,
  Cell,
  ReferenceLine,
} from "recharts";

const PIE_COLORS = [
  "#2563eb",
  "#16a34a",
  "#eab308",
  "#dc2626",
  "#9333ea",
  "#06b6d4",
  "#f97316",
  "#ec4899",
];

interface RollingWeek {
  label: string;
  actual: number;
  forecast: number;
  isFuture: boolean;
}

interface DashboardChartsProps {
  monthlyData: { month: string; actual: number; forecast: number }[];
  typeData: { name: string; value: number }[];
  rollingWeekData?: RollingWeek[];
}

// Custom bar shape that colors past vs future bars differently
function RollingBar(props: {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  isFuture?: boolean;
  value?: number;
}) {
  const { x = 0, y = 0, width = 0, height = 0, isFuture, value } = props;
  if (!value || height <= 0) return null;
  const fill = isFuture ? "#fdba74" : "#f97316"; // light orange for forecast, solid for actual
  const radius = 3;
  return (
    <rect
      x={x}
      y={y}
      width={width}
      height={height}
      fill={fill}
      rx={radius}
      ry={radius}
    />
  );
}

export function DashboardCharts({
  monthlyData,
  typeData,
  rollingWeekData,
}: DashboardChartsProps) {
  const hasMonthlyData = monthlyData.some((d) => d.actual > 0 || d.forecast > 0);
  const hasTypeData = typeData.length > 0;

  // For the rolling chart, show value = actual for past weeks, forecast for future
  const rollingChartData = (rollingWeekData ?? []).map((w) => ({
    label: w.label,
    revenue: w.isFuture ? w.forecast : w.actual,
    isFuture: w.isFuture,
  }));

  const hasRollingData = rollingChartData.some((d) => d.revenue > 0);

  // Find where "today" sits (the first future bar index)
  const todayIndex = rollingChartData.findIndex((d) => d.isFuture);
  const todayLabel = todayIndex >= 0 ? rollingChartData[todayIndex]?.label : undefined;

  return (
    <div className="space-y-4">
      {/* Rolling 12-week revenue chart — full width, most prominent */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>12-Week Revenue View</CardTitle>
            <div className="flex items-center gap-3 text-xs text-muted-foreground">
              <span className="flex items-center gap-1">
                <span className="w-3 h-3 rounded-sm bg-orange-500 inline-block" />
                Actual
              </span>
              <span className="flex items-center gap-1">
                <span className="w-3 h-3 rounded-sm bg-orange-200 inline-block" />
                Forecast
              </span>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Past 8 weeks of actual revenue · Today · Next 3 weeks forecast
          </p>
        </CardHeader>
        <CardContent className="h-64">
          {hasRollingData ? (
            <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0}>
              <BarChart data={rollingChartData} barSize={18}>
                <XAxis
                  dataKey="label"
                  fontSize={10}
                  tick={{ fill: "hsl(var(--muted-foreground))" }}
                  interval={0}
                  angle={-35}
                  textAnchor="end"
                  height={48}
                />
                <YAxis
                  fontSize={11}
                  tickFormatter={(v: number) =>
                    v >= 1000
                      ? `$${(v / 1000).toFixed(v >= 10000 ? 0 : 1)}K`
                      : `$${v.toFixed(0)}`
                  }
                  tick={{ fill: "hsl(var(--muted-foreground))" }}
                />
                <Tooltip
                  formatter={(value, _name, entry) => [
                    `$${Number(value).toLocaleString()}`,
                    entry.payload.isFuture ? "Forecast" : "Actual",
                  ]}
                  labelStyle={{ fontWeight: 600 }}
                />
                {todayLabel && (
                  <ReferenceLine
                    x={todayLabel}
                    stroke="hsl(var(--muted-foreground))"
                    strokeDasharray="4 3"
                    label={{
                      value: "Today →",
                      position: "insideTopLeft",
                      fontSize: 10,
                      fill: "hsl(var(--muted-foreground))",
                      offset: 4,
                    }}
                  />
                )}
                <Bar
                  dataKey="revenue"
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  shape={(props: any) => (
                    <RollingBar
                      x={props.x}
                      y={props.y}
                      width={props.width}
                      height={props.height}
                      value={props.value}
                      isFuture={props.isFuture}
                    />
                  )}
                  radius={[3, 3, 0, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-full flex items-center justify-center text-sm text-muted-foreground">
              Add events with sales data to see your rolling revenue view.
            </div>
          )}
        </CardContent>
      </Card>

      {/* Monthly + Event Type side by side */}
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Monthly Revenue</CardTitle>
          </CardHeader>
          <CardContent className="h-72">
            {hasMonthlyData ? (
              <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0}>
                <BarChart data={monthlyData}>
                  <XAxis dataKey="month" fontSize={12} />
                  <YAxis
                    fontSize={12}
                    tickFormatter={(v: number) =>
                      v >= 1000
                        ? `$${(v / 1000).toFixed(v >= 10000 ? 0 : 1)}K`
                        : `$${v.toFixed(0)}`
                    }
                  />
                  <Tooltip
                    formatter={(value) => [
                      `$${Number(value).toLocaleString()}`,
                      undefined,
                    ]}
                  />
                  <Legend />
                  <Bar
                    dataKey="actual"
                    name="Actual"
                    fill="#2563eb"
                    radius={[4, 4, 0, 0]}
                  />
                  <Bar
                    dataKey="forecast"
                    name="Forecast"
                    fill="#93c5fd"
                    radius={[4, 4, 0, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full flex items-center justify-center text-muted-foreground">
                Revenue chart will appear once you add events with sales data.
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Revenue by Event Type</CardTitle>
          </CardHeader>
          <CardContent className="h-72">
            {hasTypeData ? (
              <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0}>
                <PieChart>
                  <Pie
                    data={typeData}
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={100}
                    paddingAngle={2}
                    dataKey="value"
                    label={({ name, percent }) =>
                      `${name ?? ""} ${((percent ?? 0) * 100).toFixed(0)}%`
                    }
                    labelLine={false}
                  >
                    {typeData.map((_, i) => (
                      <Cell
                        key={`cell-${i}`}
                        fill={PIE_COLORS[i % PIE_COLORS.length]}
                      />
                    ))}
                  </Pie>
                  <Tooltip
                    formatter={(value) => [
                      `$${Number(value).toLocaleString()}`,
                      "Revenue",
                    ]}
                  />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full flex items-center justify-center text-muted-foreground">
                Event type breakdown will appear once you add events.
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
