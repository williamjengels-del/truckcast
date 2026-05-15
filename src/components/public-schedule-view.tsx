import Link from "next/link";
import { TruckIcon, MapPin, Clock, Calendar, ArrowRight } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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

          {/* Primary CTA — request-a-booking. The operator-acquisition
              wedge: every operator who shares their vendcast.co/<slug>
              link in their bio is doing it so organizers can both see
              the schedule AND request bookings directly. Pre-this-PR
              the page was read-only; organizers had no path forward.
              Orange = closer action per brand discipline. */}
          <div className="mt-5 flex justify-center">
            <Link
              href={`/book/${userId}`}
              data-testid="public-schedule-request-booking-cta"
            >
              <Button
                size="lg"
                className="rounded-full bg-brand-orange text-white hover:bg-brand-orange/90 gap-2"
              >
                Request a booking
                <ArrowRight className="h-4 w-4" />
              </Button>
            </Link>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8 max-w-2xl">
        {upcomingEvents.length === 0 ? (
          // Empty state — still lead with the booking CTA. Organizers
          // landing on a quiet schedule shouldn't bounce; the operator's
          // calendar being open is the buying signal.
          <Card>
            <CardContent
              className="py-12 text-center"
              data-testid="public-schedule-empty"
            >
              <Calendar className="h-10 w-10 text-muted-foreground/40 mx-auto mb-3" />
              <p className="text-foreground font-medium mb-1">
                No public events scheduled right now.
              </p>
              <p className="text-sm text-muted-foreground mb-5">
                Have an event in mind? Send a booking request — the operator
                will get back to you directly.
              </p>
              <Link href={`/book/${userId}`}>
                <Button className="bg-brand-orange text-white hover:bg-brand-orange/90 gap-2">
                  Request a booking
                  <ArrowRight className="h-4 w-4" />
                </Button>
              </Link>
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

            {/* Bottom CTA — after the organizer has scrolled the
                schedule and gotten a sense of what this operator does,
                close with a second booking-request prompt. Restated
                instead of just "above the fold" — the page can be
                long on a busy schedule and the header CTA scrolls out
                of view. */}
            <Card className="mt-2 border-brand-orange/30 bg-brand-orange/5">
              <CardContent className="py-6 text-center">
                <p className="text-foreground font-medium mb-1">
                  Got an event for {profile.business_name}?
                </p>
                <p className="text-sm text-muted-foreground mb-4">
                  Send a request and they&apos;ll get back to you
                  directly — no commission, no middleman.
                </p>
                <Link href={`/book/${userId}`}>
                  <Button className="bg-brand-orange text-white hover:bg-brand-orange/90 gap-2">
                    Request a booking
                    <ArrowRight className="h-4 w-4" />
                  </Button>
                </Link>
              </CardContent>
            </Card>
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
