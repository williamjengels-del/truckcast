"use client";

import { Card, CardContent } from "@/components/ui/card";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from "recharts";

interface RollingWeek {
  label: string;
  actual: number;
  forecast: number;
  isFuture: boolean;
}

interface HeroChartProps {
  rollingWeekData: RollingWeek[];
}

// Custom bar shape — solid orange for actual, lighter for projected
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
  const fill = isFuture ? "#fdba74" : "#f97316";
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

export function DashboardHeroChart({ rollingWeekData }: HeroChartProps) {
  const chartData = rollingWeekData.map((w) => ({
    label: w.label,
    revenue: w.isFuture ? w.forecast : w.actual,
    isFuture: w.isFuture,
  }));

  const hasData = chartData.some((d) => d.revenue > 0);

  const todayIndex = chartData.findIndex((d) => d.isFuture);
  const todayLabel = todayIndex >= 0 ? chartData[todayIndex]?.label : undefined;

  if (!hasData) return null;

  return (
    <Card>
      <CardContent className="pt-4 pb-2">
        <div className="flex items-center justify-between mb-3">
          <p className="text-sm font-semibold">12-Week Revenue</p>
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              <span className="w-2.5 h-2.5 rounded-sm bg-orange-500 inline-block" />
              Actual
            </span>
            <span className="flex items-center gap-1">
              <span className="w-2.5 h-2.5 rounded-sm bg-orange-200 inline-block" />
              Projected
            </span>
          </div>
        </div>
        <div style={{ height: 200 }}>
          <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0}>
            <BarChart data={chartData} barSize={16} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
              <XAxis
                dataKey="label"
                fontSize={10}
                tick={{ fill: "hsl(var(--muted-foreground))" }}
                interval={0}
                angle={-35}
                textAnchor="end"
                height={44}
              />
              <YAxis
                fontSize={10}
                tickFormatter={(v: number) =>
                  v >= 1000
                    ? `$${(v / 1000).toFixed(v >= 10000 ? 0 : 1)}K`
                    : `$${v.toFixed(0)}`
                }
                tick={{ fill: "hsl(var(--muted-foreground))" }}
                width={48}
              />
              <Tooltip
                formatter={(value, _name, entry) => [
                  `$${Number(value).toLocaleString()}`,
                  entry.payload.isFuture ? "Projected" : "Actual",
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
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}
