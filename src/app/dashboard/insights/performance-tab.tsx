import { createClient } from "@/lib/supabase/server";
import { PerformanceClient } from "./performance-client";
import type { EventPerformance } from "@/lib/database.types";

export async function PerformanceTab() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  let performances: EventPerformance[] = [];
  if (user) {
    const { data } = await supabase
      .from("event_performance")
      .select("*")
      .eq("user_id", user.id)
      .order("avg_sales", { ascending: false });
    performances = (data ?? []) as EventPerformance[];
  }

  return <PerformanceClient performances={performances} />;
}
