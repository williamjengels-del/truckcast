import Link from "next/link";
import { resolveScopedSupabase } from "@/lib/dashboard-scope";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { FileText, Upload, Plus } from "lucide-react";
import type { Event, EventPerformance } from "@/lib/database.types";
import { ReportsInteractive } from "./reports-interactive";
import { computeReportsAggregates } from "@/lib/reports-aggregates";

export async function ReportsTab() {
  const scope = await resolveScopedSupabase();

  let events: Event[] = [];
  let performances: EventPerformance[] = [];

  if (scope.kind !== "unauthorized") {
    const [eventsRes, perfRes] = await Promise.all([
      scope.client
        .from("events")
        .select("*")
        .eq("user_id", scope.userId)
        .order("event_date", { ascending: false }),
      scope.client
        .from("event_performance")
        .select("*")
        .eq("user_id", scope.userId)
        .order("avg_sales", { ascending: false }),
    ]);
    events = (eventsRes.data ?? []) as Event[];
    performances = (perfRes.data ?? []) as EventPerformance[];
  }

  const aggregates = computeReportsAggregates(events, performances);

  if (aggregates.eventsCompleted === 0) {
    return (
      <div className="space-y-4">
        <div>
          <h2 className="text-xl font-semibold">Reports</h2>
          <p className="text-muted-foreground text-sm">
            Performance reports and insights from your event history
          </p>
        </div>
        <Card>
          <CardContent className="py-14 text-center space-y-4">
            <FileText className="h-12 w-12 mx-auto text-muted-foreground/30" />
            <div>
              <p className="font-medium">No sales data yet</p>
              <p className="text-muted-foreground text-sm mt-1 max-w-sm mx-auto">
                Reports show monthly summaries, top events, revenue by type, and year-over-year comparisons — once you have events with sales logged.
              </p>
            </div>
            <div className="flex gap-2 justify-center">
              <Link href="/dashboard/integrations?tab=csv-import">
                <Button size="sm" className="gap-1.5">
                  <Upload className="h-3.5 w-3.5" />
                  Import events
                </Button>
              </Link>
              <Link href="/dashboard/events?new=true">
                <Button size="sm" variant="outline" className="gap-1.5">
                  <Plus className="h-3.5 w-3.5" />
                  Add manually
                </Button>
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return <ReportsInteractive {...aggregates} />;
}
