export const dynamic = "force-dynamic";
import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import { TruckIcon, MapPin, Clock, Calendar } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

interface Props {
  params: Promise<{ token: string }>;
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

function formatTodayLabel() {
  return new Date().toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

export default async function TeamViewPage({ params }: Props) {
  const { token } = await params;
  const supabase = await createClient();

  // Look up profile by team_share_token
  const { data: profile } = await supabase
    .from("profiles")
    .select("id, business_name, city, state")
    .eq("team_share_token", token)
    .single();

  if (!profile) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-muted/30">
        <div className="text-center space-y-2">
          <TruckIcon className="h-10 w-10 text-muted-foreground mx-auto" />
          <h1 className="text-xl font-semibold">Link Not Found</h1>
          <p className="text-muted-foreground text-sm max-w-xs">
            This link is invalid or has been revoked. Ask your manager for a new link.
          </p>
        </div>
      </div>
    );
  }

  const today = new Date().toISOString().split("T")[0];
  // eslint-disable-next-line react-hooks/purity
  const in14Days = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000)
    .toISOString()
    .split("T")[0];

  // Today's events
  const { data: todayEvents } = await supabase
    .from("events")
    .select("event_name, event_date, start_time, end_time, location, city")
    .eq("user_id", profile.id)
    .eq("booked", true)
    .eq("event_date", today)
    .order("start_time", { ascending: true });

  // Upcoming events (next 14 days, excluding today)
  const { data: upcomingEvents } = await supabase
    .from("events")
    .select("event_name, event_date, start_time, end_time, location, city")
    .eq("user_id", profile.id)
    .eq("booked", true)
    .neq("is_private", true)
    .gt("event_date", today)
    .lte("event_date", in14Days)
    .order("event_date", { ascending: true })
    .order("start_time", { ascending: true });

  const todayList = todayEvents ?? [];
  const upcomingList = upcomingEvents ?? [];

  return (
    <div className="min-h-screen bg-muted/30">
      {/* Header */}
      <header className="bg-card border-b">
        <div className="container mx-auto px-4 py-6 text-center">
          <TruckIcon className="h-10 w-10 text-primary mx-auto mb-2" />
          <h1 className="text-2xl font-bold">{profile.business_name ?? "Team Schedule"}</h1>
          {(profile.city || profile.state) && (
            <p className="text-muted-foreground text-sm mt-1 flex items-center justify-center gap-1">
              <MapPin className="h-3.5 w-3.5" />
              {[profile.city, profile.state].filter(Boolean).join(", ")}
            </p>
          )}
          <p className="text-sm font-medium text-primary mt-2">Team Schedule</p>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8 max-w-xl space-y-8">
        {/* Today's date prominently */}
        <div className="text-center">
          <div className="inline-flex items-center gap-2 bg-primary/10 text-primary rounded-full px-4 py-1.5 text-sm font-medium">
            <Calendar className="h-4 w-4" />
            {formatTodayLabel()}
          </div>
        </div>

        {/* Today's Events */}
        <section>
          <h2 className="text-base font-semibold mb-3 text-foreground">
            Today&apos;s Events
          </h2>
          {todayList.length === 0 ? (
            <Card>
              <CardContent className="py-6 text-center text-sm text-muted-foreground">
                No events scheduled today.
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-2">
              {todayList.map((event, i) => (
                <Card key={i}>
                  <CardContent className="p-4">
                    <h3 className="font-semibold text-base">{event.event_name}</h3>
                    {(event.start_time || event.end_time) && (
                      <p className="text-sm text-muted-foreground flex items-center gap-1 mt-1">
                        <Clock className="h-3.5 w-3.5" />
                        {formatTime(event.start_time)}
                        {event.end_time && ` - ${formatTime(event.end_time)}`}
                      </p>
                    )}
                    {(event.location || event.city) && (
                      <p className="text-sm text-muted-foreground flex items-center gap-1 mt-1">
                        <MapPin className="h-3.5 w-3.5" />
                        {[event.location, event.city].filter(Boolean).join(" — ")}
                      </p>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </section>

        {/* Upcoming Events */}
        <section>
          <h2 className="text-base font-semibold mb-3 text-foreground">
            Upcoming Events (Next 14 Days)
          </h2>
          {upcomingList.length === 0 ? (
            <Card>
              <CardContent className="py-6 text-center text-sm text-muted-foreground">
                No upcoming events in the next 14 days.
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-2">
              {upcomingList.map((event, i) => (
                <Card key={i}>
                  <CardContent className="p-4">
                    <p className="text-xs text-primary font-medium mb-1">
                      {formatDate(event.event_date)}
                    </p>
                    <h3 className="font-semibold">{event.event_name}</h3>
                    {(event.start_time || event.end_time) && (
                      <p className="text-sm text-muted-foreground flex items-center gap-1 mt-1">
                        <Clock className="h-3.5 w-3.5" />
                        {formatTime(event.start_time)}
                        {event.end_time && ` - ${formatTime(event.end_time)}`}
                      </p>
                    )}
                    {(event.location || event.city) && (
                      <p className="text-sm text-muted-foreground flex items-center gap-1 mt-1">
                        <MapPin className="h-3.5 w-3.5" />
                        {[event.location, event.city].filter(Boolean).join(" — ")}
                      </p>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </section>
      </main>

      <footer className="border-t py-6 mt-8">
        <div className="container mx-auto px-4 text-center text-xs text-muted-foreground">
          Powered by{" "}
          <Link href="/" className="text-primary hover:underline">
            TruckCast
          </Link>
        </div>
      </footer>
    </div>
  );
}
