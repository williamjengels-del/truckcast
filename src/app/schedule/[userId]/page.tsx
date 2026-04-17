export const dynamic = "force-dynamic";
import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { TruckIcon, MapPin, Clock, Calendar } from "lucide-react";

interface Props {
  params: Promise<{ userId: string }>;
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

export default async function PublicSchedulePage({ params }: Props) {
  const { userId } = await params;
  const supabase = await createClient();

  // Fetch the user's profile (public info only)
  const { data: profile } = await supabase
    .from("profiles")
    .select("business_name, city, state, subscription_tier")
    .eq("id", userId)
    .single();

  // Only Pro+ users get a public schedule page
  if (
    !profile ||
    profile.subscription_tier === "starter"
  ) {
    return (
      <div className="min-h-screen flex items-center justify-center text-muted-foreground">
        This schedule page is not available.
      </div>
    );
  }

  // Fetch upcoming booked events
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

  const upcomingEvents = events ?? [];

  // Group events by month
  const grouped = new Map<string, typeof upcomingEvents>();
  for (const e of upcomingEvents) {
    const monthKey = new Date(e.event_date + "T00:00:00").toLocaleString(
      "en-US",
      { month: "long", year: "numeric" }
    );
    if (!grouped.has(monthKey)) grouped.set(monthKey, []);
    grouped.get(monthKey)!.push(e);
  }

  return (
    <div className="min-h-screen bg-muted/30">
      {/* Header */}
      <header className="bg-card border-b">
        <div className="container mx-auto px-4 py-8 text-center">
          <TruckIcon className="h-12 w-12 text-primary mx-auto mb-3" />
          <h1 className="text-3xl font-bold">{profile.business_name}</h1>
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

      {/* Schedule */}
      <main className="container mx-auto px-4 py-8 max-w-2xl">
        {upcomingEvents.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center text-muted-foreground">
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
                            <h3 className="font-semibold">
                              {event.event_name}
                            </h3>
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
                              <Badge variant="outline">
                                {event.event_type}
                              </Badge>
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

      {/* Footer */}
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
