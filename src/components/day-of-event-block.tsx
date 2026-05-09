import Link from "next/link";
import { headers } from "next/headers";
import {
  Calendar,
  Clock,
  CloudRain,
  MapPin,
  Menu as MenuIcon,
  Phone,
  Mail,
  MessageSquare,
  Plus,
  Thermometer,
  Wind,
} from "lucide-react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import type { Event, Contact, SubscriptionTier } from "@/lib/database.types";
import {
  geocodeCity,
  getWeatherForEvent,
  getHourlyWeatherForEvent,
  sliceHourlyToServiceWindow,
  wmoCodeToCondition,
  type HourlyWeatherEntry,
} from "@/lib/weather";
import { wallclockInZoneToUtcMs } from "@/lib/wallclock-tz";
import { findSalesComparable } from "@/lib/sales-pace";
import { computeDayOfState } from "@/lib/day-of-event-state";
import { SetupCountdown } from "@/components/setup-countdown";
import { InServiceNotes } from "@/components/in-service-notes";
import { ContentCapture } from "@/components/content-capture";
import { SalesPaceBar } from "@/components/sales-pace-bar";
import { AfterEventSummary } from "@/components/after-event-summary";

interface Props {
  events: Event[];
  timezone: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any, "public", any>;
  userId: string;
  subscriptionTier: SubscriptionTier;
  /** Hide sales pace + Log-sales CTA + after-event wrap-up for managers
   *  whose owner has not granted Financials access. Defaults to true so
   *  owners + admins keep full visibility. */
  canSeeFinancials?: boolean;
}

const WIND_ALERT_THRESHOLD_MPH = 20; // Spec §5: canopy threshold.

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
  hourly: HourlyWeatherEntry[] | null;
}

async function resolveWeather(
  event: Event,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any, "public", any>,
  fetchHourly: boolean
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
  // Daily + hourly run in parallel since both hit Supabase / Open-Meteo
  // independently. Skipping the hourly call entirely for Starter
  // saves a Supabase round-trip (and a possible Open-Meteo call) per
  // dashboard render — this matters because the dashboard is the
  // most-hit page in the app.
  const [daily, hourly] = await Promise.all([
    getWeatherForEvent(lat, lng, event.event_date, supabase),
    fetchHourly
      ? getHourlyWeatherForEvent(lat, lng, event.event_date, supabase)
      : Promise.resolve(null),
  ]);
  if (!daily) return null;
  return {
    maxTempF: daily.data.maxTempF,
    minTempF: daily.data.minTempF,
    precipitationIn: daily.data.precipitationIn,
    classification: daily.classification,
    hourly,
  };
}

export async function DayOfEventBlock({
  events,
  timezone,
  supabase,
  userId,
  subscriptionTier,
  canSeeFinancials = true,
}: Props) {
  const isPaidTier = subscriptionTier === "pro" || subscriptionTier === "premium";
  const isPremium = subscriptionTier === "premium";
  const today = todayInTz(timezone);

  const bookedFuture = events
    .filter((e) => e.booked && !e.cancellation_reason && e.event_date >= today)
    .sort((a, b) => {
      if (a.event_date !== b.event_date) return a.event_date.localeCompare(b.event_date);
      return (a.start_time ?? "99:99").localeCompare(b.start_time ?? "99:99");
    });

  // Auto-end aware state machine: picks the right "current" event,
  // stacks "Up next today," and falls through to tomorrow / future
  // when today is exhausted. Auto-ended audit IDs let us lazily
  // backfill auto_ended_at server-side without a cron.
  //
  // `Date.now()` here is safe in this Server Component — it renders
  // once per request, so the snapshot is stable for the whole render
  // tree. The react-hooks/purity rule flags it as impure (correct
  // guidance for client components where re-renders happen mid-session,
  // but not applicable to RSC). Snapshotting to a local first so the
  // disable is scoped tightly.
  // eslint-disable-next-line react-hooks/purity -- Server Component renders once per request; nowMs is request-stable.
  const nowMs = Date.now();
  const state = computeDayOfState(bookedFuture, today, nowMs, timezone);
  if (!state.current) {
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
  const event = state.current;
  const isToday = state.kind === "today";
  const upcomingToday = state.upcomingToday;

  // Lazy auto-end audit: when we discover events that have ended
  // since the last render, fire-and-forget set auto_ended_at. Not
  // awaited — the card render must not block on this. RLS keeps the
  // write scoped to the operator's own rows.
  if (state.endedTodayIds.length > 0) {
    void supabase
      .from("events")
      .update({ auto_ended_at: new Date().toISOString() })
      .in("id", state.endedTodayIds)
      .eq("user_id", userId)
      .is("auto_ended_at", null)
      .then(() => undefined);
  }

  const [weather, contactsRes, hdrs, comparable] = await Promise.all([
    // Hourly only fetched for paid tiers — Starter sees daily-only.
    resolveWeather(event, supabase, isPaidTier),
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
    // Sales pace comparable — only on today's event (live feature per
    // spec §12). Starter+ — comparison is to operator's own history,
    // not a paid feature.
    isToday
      ? findSalesComparable(supabase, userId, event)
      : Promise.resolve(null),
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
  // Service-window-scoped hourly slice + wind alert derivation.
  // Both depend on the operator having an hourly fetch (Pro+) AND a
  // start_time on the event (so we know which hours are "service").
  // Wind alert is Premium-only per the locked tier matrix.
  const serviceHourly: HourlyWeatherEntry[] | null =
    weather?.hourly && (event.start_time || event.end_time)
      ? sliceHourlyToServiceWindow(weather.hourly, event.start_time, event.end_time)
      : null;
  const windAlertMaxMph: number | null =
    isPremium && serviceHourly && serviceHourly.length > 0
      ? Math.max(...serviceHourly.map((h) => h.windMph))
      : null;
  const showWindAlert =
    windAlertMaxMph !== null && windAlertMaxMph >= WIND_ALERT_THRESHOLD_MPH;

  // Match the existing Needs Attention convention: route to the
  // flagged tab, where the SalesEntryDialog opens on row click.
  // Only surface the action when there's something to log — today's
  // event with no sales recorded (or any past row that slipped past
  // the cutoff), mirroring the unloggedEvents filter on page.tsx.
  const showLogSales =
    canSeeFinancials &&
    event.event_date <= today &&
    event.net_sales === null &&
    !(event.event_mode === "catering" && event.invoice_revenue > 0);

  return (
    <Card data-testid="day-of-event-block" className="border-brand-orange/40">
      <CardContent className="py-5 space-y-4">
        {/* After-event wrap-up surfaces above the main card content
            when a today event has just ended without a summary.
            Operator can fill or skip; "Skip for now" hides locally,
            saving for the events page. Pro+ only — Starter day-of
            card is restricted to event name + time-to-setup +
            address + start/end time. */}
        {isPaidTier && canSeeFinancials && state.needsWrapUp && (
          <AfterEventSummary
            eventId={state.needsWrapUp.id}
            eventName={state.needsWrapUp.event_name}
            endTimeDisplay={formatTimeHHMM(state.needsWrapUp.end_time)}
            initialNetSales={state.needsWrapUp.net_sales}
          />
        )}

        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-widest text-brand-orange">
              {state.kind === "today"
                ? upcomingToday.length > 0
                  ? "Now"
                  : "Today's event"
                : state.kind === "tomorrow"
                ? "Tomorrow's event"
                : `Next event — ${formatEventDate(event.event_date)}`}
            </p>
            <h2 className="text-xl md:text-2xl font-bold tracking-tight mt-1 truncate">
              {event.event_name}
            </h2>
          </div>
          {/* Log-sales CTA on the day-of card is a Pro+ surface. Starter
              operators still log sales — they just do it from /events
              instead of from the day-of card, which keeps Starter's
              day-of view to the bare scheduling essentials. */}
          {isPaidTier && showLogSales && (
            <Link
              href="/dashboard/events?tab=needs_attention&chips=missing-sales"
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

          {isPaidTier && event.parking_loadin_notes && (
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

          {isPaidTier && weather && (
            <div className="flex items-start gap-2 text-sm" data-testid="day-of-event-weather">
              <Thermometer className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
              <div className="min-w-0">
                {/* Daily high/low + classification — shown on every tier
                    as the always-visible summary. */}
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

                {/* Pro+: single-line service-window summary. Hourly
                    range of temps + most-common condition during
                    service hours. */}
                {isPaidTier && serviceHourly && serviceHourly.length > 0 && (
                  <p
                    className="text-xs text-muted-foreground mt-1"
                    data-testid="day-of-event-weather-service-window"
                  >
                    Service{" "}
                    {formatTimeHHMM(event.start_time) ?? "—"}–
                    {formatTimeHHMM(event.end_time) ?? "—"}:{" "}
                    {Math.round(Math.min(...serviceHourly.map((h) => h.tempF)))}–
                    {Math.round(Math.max(...serviceHourly.map((h) => h.tempF)))}°,{" "}
                    {wmoCodeToCondition(
                      // Use the modal weather code in the window.
                      serviceHourly
                        .map((h) => h.weatherCode)
                        .sort(
                          (a, b) =>
                            serviceHourly.filter((h) => h.weatherCode === b).length -
                            serviceHourly.filter((h) => h.weatherCode === a).length
                        )[0] ?? 0
                    ).toLowerCase()}
                  </p>
                )}

                {/* Premium: hour-by-hour breakdown grid. */}
                {isPremium && serviceHourly && serviceHourly.length > 0 && (
                  <div
                    className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs"
                    data-testid="day-of-event-weather-hourly"
                  >
                    {serviceHourly.map((h) => (
                      <div key={h.hour} className="flex flex-col items-center min-w-[2.75rem]">
                        <span className="text-muted-foreground">
                          {h.hour === 0
                            ? "12a"
                            : h.hour < 12
                            ? `${h.hour}a`
                            : h.hour === 12
                            ? "12p"
                            : `${h.hour - 12}p`}
                        </span>
                        <span className="font-medium">{Math.round(h.tempF)}°</span>
                        {h.windMph >= WIND_ALERT_THRESHOLD_MPH && (
                          <span className="text-destructive font-medium">
                            {Math.round(h.windMph)}mph
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Wind alert — Premium only (also implies Pro+, so the
              isPaidTier gate above the weather block doesn't need
              to repeat here). Surfaces below weather row when any
              service hour exceeds the canopy threshold. */}
          {showWindAlert && (
            <div
              className="flex items-start gap-2 text-sm sm:col-span-2 -mt-1 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2"
              data-testid="day-of-event-wind-alert"
            >
              <Wind className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
              <p className="text-sm font-medium text-destructive">
                Wind {Math.round(windAlertMaxMph!)}mph during service — secure canopy
              </p>
            </div>
          )}

          {/* Menu indicator — only surfaces when not the regular menu.
              "Regular menu" is the default + the assumed state, so
              showing a "Regular" badge would just be visual noise.
              Pro+ only on day-of card (Starter day-of stays minimal). */}
          {isPaidTier && event.menu_type === "special" && (
            <div
              className="flex items-start gap-2 text-sm min-w-0"
              data-testid="day-of-event-menu-special"
            >
              <MenuIcon className="h-4 w-4 text-brand-orange shrink-0 mt-0.5" />
              <div className="min-w-0">
                <p className="font-medium text-brand-orange">
                  Special menu
                </p>
                {event.special_menu_details && (
                  // Render as link if it looks like a URL, otherwise
                  // as plain text. Avoids surprising the operator
                  // with a tap-target on free-text entries.
                  /^https?:\/\//i.test(event.special_menu_details) ? (
                    <a
                      href={event.special_menu_details}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-primary hover:underline truncate block"
                    >
                      {event.special_menu_details}
                    </a>
                  ) : (
                    <p className="text-xs text-muted-foreground truncate">
                      {event.special_menu_details}
                    </p>
                  )
                )}
              </div>
            </div>
          )}

          {isPaidTier && contact && (contact.phone || contact.email) && (
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

        {/* Sales pace bar — only on today's event. Hidden for catering
            (compare-against-invoice is out of scope for v1) and for
            managers without Financials access (revenue display). Pro+
            only — Starter day-of card is restricted to scheduling
            essentials. */}
        {isPaidTier && canSeeFinancials && isToday && event.event_mode !== "catering" && (
          <div className="pt-2 border-t border-border/40">
            <SalesPaceBar
              currentSales={event.net_sales ?? 0}
              comparable={comparable}
            />
          </div>
        )}

        {/* In-service notes + content capture render only on today's
            event — they're operator-driven during the event itself.
            Next-event / tomorrow cards strip these. Pro+ — Starter
            day-of card stays minimal. */}
        {isPaidTier && isToday && (
          <div className="space-y-4 pt-2 border-t border-border/40">
            <InServiceNotes
              eventId={event.id}
              initialNotes={event.in_service_notes ?? []}
              timezone={timezone}
            />
            <ContentCapture
              eventId={event.id}
              initialValue={event.content_capture_notes}
            />
          </div>
        )}

        {/* Up next today — collapsed previews of additional today
            events still ahead. Spec §10: "stacked Now: [A] +
            Up next today: [B] (collapsed preview, expands when A ends)."
            v1 ships the collapsed list; auto-promotion of the next
            event is handled by computeDayOfState on the next render
            (i.e., when A's end_time passes). */}
        {isPaidTier && upcomingToday.length > 0 && (
          <div className="pt-2 border-t border-border/40 space-y-2" data-testid="day-of-event-upcoming-today">
            <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
              Up next today
            </p>
            <ul className="space-y-2">
              {upcomingToday.map((u) => (
                <li
                  key={u.id}
                  className="flex items-center gap-3 text-sm rounded-md bg-muted/40 px-3 py-2"
                >
                  <Clock className="h-4 w-4 text-muted-foreground shrink-0" />
                  <div className="min-w-0 flex-1">
                    <p className="font-medium truncate">{u.event_name}</p>
                    {(u.start_time || u.end_time) && (
                      <p className="text-xs text-muted-foreground">
                        {formatTimeHHMM(u.start_time) ?? "—"}
                        {u.end_time && ` – ${formatTimeHHMM(u.end_time) ?? ""}`}
                        {u.location ? ` · ${u.location}` : ""}
                      </p>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}
        {/* Note: events table doesn't carry organizer_name / phone /
            email columns directly. The contact surface above is joined
            from the contacts table via linked_event_names. If an
            event's organizer isn't also a logged contact, the contact
            row is omitted by design. Marketplace inquiries that
            auto-create events stitch the organizer details into
            event.notes instead — see api/event-inquiries/action. */}
      </CardContent>
    </Card>
  );
}
