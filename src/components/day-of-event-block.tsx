import Link from "next/link";
import { headers } from "next/headers";
import {
  Calendar,
  Clock,
  CloudRain,
  MapPin,
  Phone,
  Mail,
  MessageSquare,
  Plus,
  Thermometer,
} from "lucide-react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import type { Event, Contact } from "@/lib/database.types";
import { geocodeCity, getWeatherForEvent } from "@/lib/weather";
import { wallclockInZoneToUtcMs } from "@/lib/wallclock-tz";
import { SetupCountdown } from "@/components/setup-countdown";

interface Props {
  events: Event[];
  timezone: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any, "public", any>;
  userId: string;
}

// "Today" as a YYYY-MM-DD string in the operator's timezone. Using
// en-CA locale because it formats as ISO (YYYY-MM-DD), matching the
// shape of events.event_date for direct string comparison. Comparing
// UTC ISO strings to event_date loses a day near midnight Central.
function todayInTz(tz: string): string {
  try {
    return new Date().toLocaleDateString("en-CA", { timeZone: tz });
  } catch {
    return new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
  }
}

function formatEventDate(dateIso: string): string {
  return new Date(dateIso + "T00:00:00").toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

function formatTimeHHMM(t: string | null): string | null {
  if (!t) return null;
  const [hh, mm] = t.split(":");
  const h = parseInt(hh, 10);
  const m = parseInt(mm, 10);
  if (isNaN(h) || isNaN(m)) return null;
  const period = h >= 12 ? "PM" : "AM";
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  const minStr = m.toString().padStart(2, "0");
  return `${hour12}:${minStr} ${period}`;
}

function composeAddress(event: Event): string | null {
  const parts: string[] = [];
  if (event.location) parts.push(event.location);
  if (event.city) parts.push(event.city);
  if (event.state) parts.push(event.state);
  if (parts.length === 0) return null;
  return parts.join(", ");
}

function mapsHref(address: string, isIOS: boolean): string {
  const q = encodeURIComponent(address);
  // iOS: maps.apple.com universal link. Opens native Apple Maps when
  // clicked from Safari/Mobile Chrome on iOS, falls back to web view
  // on desktop Safari. Other platforms get the Google Maps universal
  // link (opens Google Maps app on Android via intent, web elsewhere).
  return isIOS
    ? `https://maps.apple.com/?q=${q}`
    : `https://www.google.com/maps/search/?api=1&query=${q}`;
}

function detectIOSFromUserAgent(ua: string | null): boolean {
  if (!ua) return false;
  // iPad/iPhone/iPod cover historical iOS devices; iPad on iPadOS 13+
  // reports as Macintosh — operators in the field tend to use iPhone,
  // so the desktop-Mac false-negative is fine. Apple Maps web link
  // works on desktop Safari anyway, so misclassification is low-cost.
  return /iPad|iPhone|iPod/.test(ua);
}

function onlyDigits(phone: string): string {
  return phone.replace(/\D/g, "");
}

interface WeatherSnapshot {
  maxTempF: number;
  minTempF: number;
  precipitationIn: number;
  classification: string;
}

async function resolveWeather(
  event: Event,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any, "public", any>
): Promise<WeatherSnapshot | null> {
  let lat = event.latitude;
  let lng = event.longitude;
  if ((lat == null || lng == null) && event.city) {
    const coords = await geocodeCity(event.city, event.state);
    if (!coords) return null;
    lat = coords.latitude;
    lng = coords.longitude;
  }
  if (lat == null || lng == null) return null;
  const result = await getWeatherForEvent(lat, lng, event.event_date, supabase);
  if (!result) return null;
  return {
    maxTempF: result.data.maxTempF,
    minTempF: result.data.minTempF,
    precipitationIn: result.data.precipitationIn,
    classification: result.classification,
  };
}

export async function DayOfEventBlock({ events, timezone, supabase, userId }: Props) {
  const today = todayInTz(timezone);

  const bookedFuture = events
    .filter((e) => e.booked && !e.cancellation_reason && e.event_date >= today)
    .sort((a, b) => {
      if (a.event_date !== b.event_date) return a.event_date.localeCompare(b.event_date);
      return (a.start_time ?? "99:99").localeCompare(b.start_time ?? "99:99");
    });

  if (bookedFuture.length === 0) {
    return (
      <Card data-testid="day-of-event-block">
        <CardContent className="py-6 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Calendar className="h-5 w-5 text-muted-foreground shrink-0" />
            <div>
              <p className="text-sm font-medium">No events scheduled</p>
              <p className="text-xs text-muted-foreground">
                Add your next booking to see it here.
              </p>
            </div>
          </div>
          <Link href="/dashboard/events?new=true" data-testid="day-of-event-add-link">
            <Button size="sm" variant="outline" className="gap-1.5">
              <Plus className="h-3.5 w-3.5" />
              Add event
            </Button>
          </Link>
        </CardContent>
      </Card>
    );
  }

  const todaysEvents = bookedFuture.filter((e) => e.event_date === today);
  const isToday = todaysEvents.length > 0;
  const event = isToday ? todaysEvents[0] : bookedFuture[0];
  const additionalTodayCount = isToday ? todaysEvents.length - 1 : 0;

  const [weather, contactsRes, hdrs] = await Promise.all([
    resolveWeather(event, supabase),
    supabase
      .from("contacts")
      .select("id, name, phone, email, linked_event_names, quality_score, created_at")
      .eq("user_id", userId)
      .contains("linked_event_names", [event.event_name])
      // Highest-quality contact first; fall back to most-recently-created.
      // Spec: "If multiple contacts on the event, show primary with small
      // 'view all' link." quality_score is the closest existing proxy
      // for "primary."
      .order("quality_score", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false }),
    headers(),
  ]);

  const allContacts = (contactsRes.data as Contact[] | null) ?? [];
  const contact = allContacts[0] ?? null;
  const additionalContactCount = Math.max(0, allContacts.length - 1);
  const isIOS = detectIOSFromUserAgent(hdrs.get("user-agent"));

  const setupDisplay = formatTimeHHMM(event.setup_time);
  const startDisplay = formatTimeHHMM(event.start_time);
  const endDisplay = formatTimeHHMM(event.end_time);
  const address = composeAddress(event);
  // Setup countdown — only on today's event (next-day cards strip
  // live-only features per spec §12). Compute the UTC instant
  // server-side so the client island doesn't have to know zone math.
  const setupInstantMs =
    isToday && event.setup_time
      ? wallclockInZoneToUtcMs(event.event_date, event.setup_time, timezone)
      : null;
  // Match the existing Needs Attention convention: route to the
  // flagged tab, where the SalesEntryDialog opens on row click.
  // Only surface the action when there's something to log — today's
  // event with no sales recorded (or any past row that slipped past
  // the cutoff), mirroring the unloggedEvents filter on page.tsx.
  const showLogSales =
    event.event_date <= today &&
    event.net_sales === null &&
    !(event.event_mode === "catering" && event.invoice_revenue > 0);

  return (
    <Card data-testid="day-of-event-block" className="border-orange-200 dark:border-orange-900/40">
      <CardContent className="py-5 space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-widest text-orange-700 dark:text-orange-400">
              {isToday ? "Today's event" : `Next event — ${formatEventDate(event.event_date)}`}
            </p>
            <h2 className="text-xl md:text-2xl font-bold tracking-tight mt-1 truncate">
              {event.event_name}
            </h2>
            {additionalTodayCount > 0 && (
              <Link
                href="/dashboard/events?tab=upcoming"
                className="inline-block mt-1 text-xs font-medium text-orange-700 dark:text-orange-400 hover:underline"
              >
                +{additionalTodayCount} more today
              </Link>
            )}
          </div>
          {showLogSales && (
            <Link
              href="/dashboard/events?tab=flagged"
              className="shrink-0"
              data-testid="day-of-event-log-sales"
            >
              <Button size="sm" className="gap-1.5">
                <Plus className="h-3.5 w-3.5" />
                {event.event_mode === "catering" ? "Log invoice" : "Log sales"}
              </Button>
            </Link>
          )}
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          {setupInstantMs !== null && setupDisplay ? (
            <SetupCountdown
              setupInstantMs={setupInstantMs}
              setupDisplay={setupDisplay}
            />
          ) : (
            <div className="flex items-start gap-2 text-sm">
              <Clock className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
              <div className="min-w-0">
                {setupDisplay && (
                  <p className="text-xs text-muted-foreground">
                    Setup <span className="text-foreground font-medium">{setupDisplay}</span>
                  </p>
                )}
                {(startDisplay || endDisplay) && (
                  <p>
                    {startDisplay && <span className="font-medium">{startDisplay}</span>}
                    {startDisplay && endDisplay && <span className="text-muted-foreground"> – </span>}
                    {endDisplay && <span className="font-medium">{endDisplay}</span>}
                  </p>
                )}
                {!setupDisplay && !startDisplay && !endDisplay && (
                  <p className="text-muted-foreground">Times not set</p>
                )}
              </div>
            </div>
          )}

          {/* When the countdown takes the time slot, surface
              start–end on its own row so service hours stay visible. */}
          {setupInstantMs !== null && (startDisplay || endDisplay) && (
            <div className="flex items-start gap-2 text-sm">
              <Clock className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
              <p>
                <span className="text-xs text-muted-foreground">Service </span>
                {startDisplay && <span className="font-medium">{startDisplay}</span>}
                {startDisplay && endDisplay && <span className="text-muted-foreground"> – </span>}
                {endDisplay && <span className="font-medium">{endDisplay}</span>}
              </p>
            </div>
          )}

          {address && (
            <div className="flex items-start gap-2 text-sm min-w-0">
              <MapPin className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
              <a
                href={mapsHref(address, isIOS)}
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary hover:underline truncate"
                data-testid="day-of-event-map-link"
              >
                {address}
              </a>
            </div>
          )}

          {event.parking_loadin_notes && (
            <div className="flex items-start gap-2 text-sm min-w-0 sm:col-span-2 -mt-1">
              <span className="text-xs uppercase tracking-wide text-muted-foreground shrink-0 pt-0.5">
                Load-in
              </span>
              <p
                className="text-sm text-muted-foreground whitespace-pre-line min-w-0"
                data-testid="day-of-event-parking-notes"
              >
                {event.parking_loadin_notes}
              </p>
            </div>
          )}

          {weather && (
            <div className="flex items-start gap-2 text-sm">
              <Thermometer className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
              <div>
                <p>
                  <span className="font-medium">{Math.round(weather.maxTempF)}°</span>
                  <span className="text-muted-foreground"> / </span>
                  <span className="font-medium">{Math.round(weather.minTempF)}°</span>
                  <span className="text-muted-foreground ml-2">{weather.classification}</span>
                </p>
                {weather.precipitationIn > 0 && (
                  <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                    <CloudRain className="h-3 w-3" />
                    {weather.precipitationIn.toFixed(2)}&quot; precip
                  </p>
                )}
              </div>
              {/* TODO: add forecast at start-time hour when hourly weather
                  fetch is wired in — current server helper returns daily
                  high/low/precip only. */}
            </div>
          )}

          {contact && (contact.phone || contact.email) && (
            <div className="flex items-start gap-2 text-sm min-w-0">
              <Phone className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
              <div className="min-w-0">
                {contact.name && (
                  <p className="font-medium truncate">{contact.name}</p>
                )}
                <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs">
                  {contact.phone && (
                    <>
                      <a
                        href={`tel:${onlyDigits(contact.phone)}`}
                        className="text-primary hover:underline inline-flex items-center gap-1"
                      >
                        <Phone className="h-3 w-3" />
                        {contact.phone}
                      </a>
                      <a
                        href={`sms:${onlyDigits(contact.phone)}`}
                        className="text-primary hover:underline inline-flex items-center gap-1"
                      >
                        <MessageSquare className="h-3 w-3" />
                        Text
                      </a>
                    </>
                  )}
                  {contact.email && (
                    <a
                      href={`mailto:${contact.email}`}
                      className="text-primary hover:underline inline-flex items-center gap-1"
                    >
                      <Mail className="h-3 w-3" />
                      {contact.email}
                    </a>
                  )}
                  {additionalContactCount > 0 && (
                    <Link
                      href={`/dashboard/contacts?event=${encodeURIComponent(event.event_name)}`}
                      className="text-muted-foreground hover:text-primary hover:underline inline-flex items-center"
                      data-testid="day-of-event-view-all-contacts"
                    >
                      +{additionalContactCount} more
                    </Link>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
        {/* TODO: events table has no organizer_name / organizer_phone /
            organizer_email columns — contact surface is joined from the
            contacts table via linked_event_names. If an event's
            organizer isn't also a logged contact, the contact row is
            omitted. */}
      </CardContent>
    </Card>
  );
}
