import type { Metadata } from "next";
import { InsightsTabBar } from "./insights-tab-bar";
import { ForecastsTab } from "./forecasts-tab";
import { PerformanceTab } from "./performance-tab";
import { AnalyticsTab } from "./analytics-tab";
import { ReportsTab } from "./reports-tab";

const TAB_TITLES: Record<string, string> = {
  forecasts: "Forecasts",
  performance: "Performance",
  analytics: "Analytics",
  reports: "Reports",
};

type InsightsTab = "forecasts" | "performance" | "analytics" | "reports";

function normalizeTab(raw: string | string[] | undefined): InsightsTab {
  const v = Array.isArray(raw) ? raw[0] : raw;
  if (v === "performance" || v === "analytics" || v === "reports") return v;
  return "forecasts"; // default per Julian's spec
}

interface InsightsPageProps {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

export async function generateMetadata({ searchParams }: InsightsPageProps): Promise<Metadata> {
  const params = await searchParams;
  const tab = normalizeTab(params.tab);
  return { title: `Insights — ${TAB_TITLES[tab]}` };
}

export default async function InsightsPage({ searchParams }: InsightsPageProps) {
  const params = await searchParams;
  const tab = normalizeTab(params.tab);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Insights</h1>
        <p className="text-muted-foreground text-sm">
          Forecasts, performance, analytics, and reports for your event history.
        </p>
      </div>

      <InsightsTabBar activeTab={tab} />

      <div className="pt-2">
        {tab === "forecasts" && <ForecastsTab />}
        {tab === "performance" && <PerformanceTab />}
        {tab === "analytics" && <AnalyticsTab searchParams={searchParams} />}
        {tab === "reports" && <ReportsTab />}
      </div>
    </div>
  );
}
