import { resolveScopedSupabase } from "@/lib/dashboard-scope";
import { PerformanceClient } from "./performance-client";
import type { EventPerformance } from "@/lib/database.types";

export async function PerformanceTab() {
  const scope = await resolveScopedSupabase();

  let performances: EventPerformance[] = [];
  if (scope.kind !== "unauthorized") {
    const { data } = await scope.client
      .from("event_performance")
      .select("*")
      .eq("user_id", scope.userId)
      .order("avg_sales", { ascending: false });
    performances = (data ?? []) as EventPerformance[];
  }

  return <PerformanceClient performances={performances} />;
}
