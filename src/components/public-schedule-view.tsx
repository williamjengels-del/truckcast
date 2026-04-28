import Link from "next/link";
import { TruckIcon, MapPin, Clock, Calendar } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { createClient } from "@/lib/supabase/server";

// Shared server-rendered public schedule view. Two surfaces consume it:
//   - /schedule/[userId]   — original direct-by-id surface
//   - /[slug]              — Stage 3 custom-vendor-profile resolver
// Keeping the rendering in one component means a future copy or layout
// tweak only changes one file.

interface PublicScheduleViewProps {
  userId: string;
}

interface ProfileRow {
  business_name: string | null;
  city: string | null;
  state: string | null;
  subscription_tier: "starter" | "pro" | "premium";
}

interface EventRow {
  event_name: string;
  event_date: string;
  start_time: string | null;
  end_time: string | null;
  location: string | null;
  city: string | null;
  event_type: string | null;
}

function formatDate(dateStr: string) {
  return new Date(dateStr + "T00:00:00").toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

function formatTime(time: string | null) {
  if (!time) return null;
  const [h, m] = time.split(":");
  const hour = parseInt(h);
  const ampm = hour >= 12 ? "PM" : "AM";
  const displayHour = hour % 12 || 12;
  return `${displayHour}:${m} ${ampm}`;
}

/**
 * Fetch the public schedule data for a user. Returns null when the
 * profile doesn't exist or the operator's tier doesn't qualify for a
 * public schedule (starter tier excluded).
 */
export async function loadPublicSchedule(userId: string) {
  const supabase = await createClient();

  const { data: profile } = await supabase
    .from("profiles")
    .select("business_name, city, state, subscription_tier")
    .eq("id", userId)
    .single<ProfileRow>();

  if (!profile || profile.subscription_tier === "starter") {
    return null;
  }

  const today = new Date().toISOString().split("T")[0];
  const { data: events } = await supabase
    .from("events")
    .select(
      "event_name, event_date, start_time, end_time, location, city, event_type"
    )
    .eq("user_id", userId)
    .eq("booked", true)
    .neq("is_private", true)
    .gte("event_date", today)
    .order("event_date", { ascending: true })
    .limit(50);

  return { profile, events: (events ?? []) as EventRow[] };
}

export default async function PublicScheduleView({
  userId,
}: PublicScheduleViewProps) {
  const data = await loadPublicSchedule(userId);

  if (!data) {
    return (
      <div className="min-h-screen flex items-center justify-center text-muted-foreground">
        This schedule page is not available.
      </div>
    );
  }

  const { profile, events: upcomingEvents } = data;

  const grouped = new Map<string, EventRow[]>();
  for (const e of upcomingEvents) {
    const monthKey = new Date(e.event_date + "T00:00:00").toLocaleString(
      "en-US",
      { month: "long", year: "numeric" }
    );
    if (!grouped.has(monthKey)) grouped.set(monthKey, []);
    grouped.get(monthKey)!.push(e);
  }

  return (
    <div
      className="min-h-screen bg-muted/30"
      data-testid="public-schedule-view"
    >
      <header className="bg-card border-b">
        <div className="container mx-auto px-4 py-8 text-center">
          <TruckIcon className="h-12 w-12 text-primary mx-auto mb-3" />
          <h1
            className="text-3xl font-bold"
            data-testid="public-schedule-business-name"
          >
            {profile.business_name}
          </h1>
          {profile.city && (
            <p className="text-muted-foreground mt-1 flex items-center justify-center gap-1">
              <MapPin className="h-4 w-4" />
              {profile.city}
              {profile.state && `, ${profile.state}`}
            </p>
          )}
          <p className="text-sm text-muted-foreground mt-2">
            Upcoming Event Schedule
          </p>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8 max-w-2xl">
        {upcomingEvents.length === 0 ? (
          <Card>
            <CardContent
              className="py-12 text-center text-muted-foreground"
              data-testid="public-schedule-empty"
            >
              No upcoming events scheduled.
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-8">
            {[...grouped.entries()].map(([month, monthEvents]) => (
              <div key={month}>
                <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
                  <Calendar className="h-5 w-5" />
                  {month}
                </h2>
                <div className="space-y-3">
                  {monthEvents.map((event, i) => (
                    <Card key={i}>
                      <CardContent className="p-4">
                        <div className="flex items-start justify-between">
                          <div>
                            <h3 className="font-semibold">{event.event_name}</h3>
                            <p className="text-sm text-muted-foreground">
                              {formatDate(event.event_date)}
                            </p>
                            {(event.start_time || event.end_time) && (
                              <p className="text-sm text-muted-foreground flex items-center gap-1 mt-1">
                                <Clock className="h-3 w-3" />
                                {formatTime(event.start_time)}
                                {event.end_time &&
                                  ` - ${formatTime(event.end_time)}`}
                              </p>
                            )}
                            {(event.location || event.city) && (
                              <p className="text-sm text-muted-foreground flex items-center gap-1 mt-1">
                                <MapPin className="h-3 w-3" />
                                {event.location ?? event.city}
                              </p>
                            )}
                          </div>
                          <div className="flex gap-2">
                            {event.event_type && (
                              <Badge variant="outline">{event.event_type}</Badge>
                            )}
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </main>

      <footer className="border-t py-6 mt-12">
        <div className="container mx-auto px-4 text-center text-sm text-muted-foreground">
          Powered by{" "}
          <Link href="/" className="text-primary hover:underline">
            VendCast
          </Link>
        </div>
      </footer>
    </div>
  );
}
