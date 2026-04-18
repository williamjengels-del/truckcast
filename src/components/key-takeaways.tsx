import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Calendar, Tag, Sun, TrendingUp, Trophy, Star } from "lucide-react";
import type {
  DayOfWeekSummary,
  EventTypeBreakdown,
  MonthlySummary,
  YoYData,
} from "@/lib/reports-aggregates";

interface KeyTakeawaysProps {
  dayOfWeekSummaries: DayOfWeekSummary[];
  eventTypeBreakdown: EventTypeBreakdown[];
  monthlySummaries: MonthlySummary[];
  yoyData: YoYData[];
  bestEventName: string;
  bestEventRevenue: number;
  overallAvg: number;
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}

/**
 * "Your best day is Saturday" / "Fall is strongest" / etc. Three–five
 * auto-computed operator-facing insights. Shared between Dashboard and
 * the Reports tab of /dashboard/insights.
 */
export function KeyTakeaways({
  dayOfWeekSummaries,
  eventTypeBreakdown,
  monthlySummaries,
  yoyData,
  bestEventName,
  bestEventRevenue,
  overallAvg,
}: KeyTakeawaysProps) {
  const insights: {
    icon: React.ReactNode;
    text: React.ReactNode;
    color: string;
  }[] = [];

  const bestDay =
    dayOfWeekSummaries.length > 0
      ? [...dayOfWeekSummaries].sort((a, b) => b.avgRevenue - a.avgRevenue)[0]
      : null;
  if (bestDay && overallAvg > 0) {
    const diff = bestDay.avgRevenue - overallAvg;
    insights.push({
      icon: <Calendar className="h-5 w-5" />,
      text: (
        <>
          Your best day is <strong>{bestDay.day}</strong> — averaging{" "}
          {formatCurrency(Math.abs(diff))}{" "}
          {diff >= 0 ? "more" : "less"} than your overall average
        </>
      ),
      color: "bg-blue-50 border-blue-200 dark:bg-blue-950/30 dark:border-blue-900",
    });
  }

  const bestType =
    eventTypeBreakdown.length > 0
      ? [...eventTypeBreakdown].sort((a, b) => b.avgRevenue - a.avgRevenue)[0]
      : null;
  if (bestType && overallAvg > 0) {
    const pct = Math.round(((bestType.avgRevenue - overallAvg) / overallAvg) * 100);
    insights.push({
      icon: <Tag className="h-5 w-5" />,
      text: (
        <>
          <strong>{bestType.eventType}</strong> events average{" "}
          {pct >= 0 ? `${pct}% more` : `${Math.abs(pct)}% less`} than your overall average
          {" "}({formatCurrency(bestType.avgRevenue)} avg)
        </>
      ),
      color: "bg-green-50 border-green-200 dark:bg-green-950/30 dark:border-green-900",
    });
  }

  // Best season (Spring / Summer / Fall / Winter)
  const seasonMap = new Map<string, { totalRevenue: number; eventCount: number }>();
  for (const ms of monthlySummaries) {
    const monthNum = Number(ms.month.split("-")[1]) - 1;
    let season = "";
    if (monthNum >= 2 && monthNum <= 4) season = "Spring (Mar-May)";
    else if (monthNum >= 5 && monthNum <= 7) season = "Summer (Jun-Aug)";
    else if (monthNum >= 8 && monthNum <= 10) season = "Fall (Sep-Nov)";
    else season = "Winter (Dec-Feb)";
    if (!seasonMap.has(season)) seasonMap.set(season, { totalRevenue: 0, eventCount: 0 });
    const entry = seasonMap.get(season)!;
    entry.totalRevenue += ms.totalRevenue;
    entry.eventCount += ms.eventCount;
  }
  let bestSeason: string | null = null;
  let bestSeasonAvg = 0;
  for (const [season, data] of seasonMap) {
    const avg = data.eventCount > 0 ? data.totalRevenue / data.eventCount : 0;
    if (avg > bestSeasonAvg) {
      bestSeasonAvg = avg;
      bestSeason = season;
    }
  }
  if (bestSeason && bestSeasonAvg > 0) {
    insights.push({
      icon: <Sun className="h-5 w-5" />,
      text: (
        <>
          <strong>{bestSeason}</strong> is your strongest season, averaging{" "}
          {formatCurrency(bestSeasonAvg)}/event
        </>
      ),
      color: "bg-yellow-50 border-yellow-200 dark:bg-yellow-950/30 dark:border-yellow-900",
    });
  }

  if (yoyData.length >= 2) {
    const current = yoyData[0];
    const previous = yoyData[1];
    const pct = Math.round(
      ((current.totalRevenue - previous.totalRevenue) / previous.totalRevenue) * 100
    );
    insights.push({
      icon: <TrendingUp className="h-5 w-5" />,
      text: (
        <>
          Your revenue is{" "}
          <strong className={pct >= 0 ? "text-green-600" : "text-red-600"}>
            {pct >= 0 ? `up ${pct}%` : `down ${Math.abs(pct)}%`}
          </strong>{" "}
          compared to the same period last year ({current.year} vs {previous.year})
        </>
      ),
      color:
        pct >= 0
          ? "bg-green-50 border-green-200 dark:bg-green-950/30 dark:border-green-900"
          : "bg-red-50 border-red-200 dark:bg-red-950/30 dark:border-red-900",
    });
  }

  if (bestEventName && bestEventRevenue > 0) {
    insights.push({
      icon: <Trophy className="h-5 w-5" />,
      text: (
        <>
          Your highest earning event was <strong>{bestEventName}</strong> at{" "}
          {formatCurrency(bestEventRevenue)}
        </>
      ),
      color: "bg-purple-50 border-purple-200 dark:bg-purple-950/30 dark:border-purple-900",
    });
  }

  if (insights.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Star className="h-5 w-5" />
            Key Takeaways
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground text-sm">
            Add more events with sales data to see personalized insights.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Star className="h-5 w-5" />
          Key Takeaways
        </CardTitle>
      </CardHeader>
      <CardContent>
        {/* Horizontal swipe row on mobile; wraps to grid at sm+.
            The right-edge mask gives a visible "more to scroll" hint when the
            row overflows, addressing the low scroll affordance on phones. */}
        <div
          className="flex gap-3 overflow-x-auto pb-1 [mask-image:linear-gradient(to_right,black_calc(100%-24px),transparent)] sm:[mask-image:none]"
        >
          {insights.map((insight, i) => (
            <div
              key={i}
              className={`flex-shrink-0 rounded-lg border p-4 min-w-[240px] max-w-[300px] space-y-2 ${insight.color}`}
            >
              <div className="text-muted-foreground">{insight.icon}</div>
              <p className="text-sm leading-snug">{insight.text}</p>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
