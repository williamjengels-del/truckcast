"use client";

import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Plus,
  Search,
  DollarSign,
  Pencil,
  Trash2,
  Calendar,
  ChevronUp,
  ChevronDown,
  ChevronsUpDown,
  LayoutList,
  CalendarDays,
  Columns2,
  ChevronLeft,
  ChevronRight,
  Sun,
  Cloud,
  CloudRain,
  CloudSnow,
  Zap,
  Share2,
  Copy,
  Check,
  Download,
  CloudLightning,
  Heart,
  CopyPlus,
  BookCheck,
  RefreshCw,
} from "lucide-react";
import { EventForm } from "@/components/event-form";
import { SalesEntryDialog } from "@/components/sales-entry-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  createEvent,
  updateEvent,
  deleteEvent,
  deleteAllEvents,
  dismissFlaggedEvent,
} from "@/app/dashboard/events/actions";
import { WEATHER_COEFFICIENTS } from "@/lib/constants";
import { normalizeCityForGeocoding } from "@/lib/weather";
import type { Event } from "@/lib/database.types";
import type { EventFormData } from "@/app/dashboard/events/actions";
import { DataImportTrigger } from "@/components/data-import-guide";
import { ForecastInline } from "@/components/forecast-card";

type SortField =
  | "event_date"
  | "event_name"
  | "event_type"
  | "event_tier"
  | "location"
  | "net_sales"
  | "net_after_fees"
  | "forecast_sales"
  | "net_profit";
type SortDirection = "asc" | "desc";
type ViewMode = "list" | "split" | "calendar";
type TabMode = "all" | "upcoming" | "unbooked" | "past" | "past_unbooked" | "flagged" | "cancelled";

interface WeatherForecast {
  tempHigh: number;
  tempLow: number;
  wmoCode: number;
}

interface EventsClientProps {
  initialEvents: Event[];
  userId?: string;
  businessName?: string;
  userCity?: string;
  /** Operator's profile state code — pinned to top of dropdown, not a default. */
  userState?: string;
}

// WMO weather code to icon/label
function getWeatherInfo(code: number): { icon: React.ReactNode; label: string } {
  if (code === 0) return { icon: <Sun className="h-3.5 w-3.5 text-yellow-500" />, label: "Clear" };
  if (code <= 3) return { icon: <Cloud className="h-3.5 w-3.5 text-gray-400" />, label: "Partly Cloudy" };
  if (code <= 48) return { icon: <Cloud className="h-3.5 w-3.5 text-gray-500" />, label: "Foggy" };
  if (code <= 67) return { icon: <CloudRain className="h-3.5 w-3.5 text-blue-500" />, label: "Rain" };
  if (code <= 77) return { icon: <CloudSnow className="h-3.5 w-3.5 text-blue-200" />, label: "Snow" };
  if (code <= 82) return { icon: <CloudRain className="h-3.5 w-3.5 text-blue-600" />, label: "Rain Showers" };
  if (code <= 86) return { icon: <CloudSnow className="h-3.5 w-3.5 text-blue-300" />, label: "Snow Showers" };
  return { icon: <Zap className="h-3.5 w-3.5 text-yellow-600" />, label: "Thunderstorm" };
}

// Tiny weather icon for calendar cells (smaller)
function getWeatherIconSmall(code: number): React.ReactNode {
  if (code === 0) return <Sun className="h-3 w-3 text-yellow-500" />;
  if (code <= 3) return <Cloud className="h-3 w-3 text-gray-400" />;
  if (code <= 48) return <Cloud className="h-3 w-3 text-gray-500" />;
  if (code <= 67) return <CloudRain className="h-3 w-3 text-blue-500" />;
  if (code <= 77) return <CloudSnow className="h-3 w-3 text-blue-200" />;
  if (code <= 82) return <CloudRain className="h-3 w-3 text-blue-600" />;
  if (code <= 86) return <CloudSnow className="h-3 w-3 text-blue-300" />;
  return <Zap className="h-3 w-3 text-yellow-600" />;
}

export function EventsClient({ initialEvents, userId = "", businessName = "", userCity = "", userState = "" }: EventsClientProps) {
  // Distinct state codes used by this operator's events — floats to
  // top of EventForm's state dropdown after the profile state.
  const recentStates = useMemo(() => {
    const seen = new Set<string>();
    for (const e of initialEvents) {
      if (e.state) seen.add(e.state);
    }
    return Array.from(seen);
  }, [initialEvents]);
  const [showForm, setShowForm] = useState(false);
  const [editingEvent, setEditingEvent] = useState<Event | null>(null);
  const [duplicatingEvent, setDuplicatingEvent] = useState<Event | null>(null);
  const [salesEvent, setSalesEvent] = useState<Event | null>(null);
  const [search, setSearch] = useState("");
  const [yearFilter, setYearFilter] = useState<string>("all");
  const [modeFilter, setModeFilter] = useState<"all" | "food_truck" | "catering">("all");
  const [sortField, setSortField] = useState<SortField>("event_date");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const [deleting, setDeleting] = useState(false);
  const [bookingId, setBookingId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("split");
  const [activeTab, setActiveTab] = useState<TabMode>("upcoming");
  const [calendarMonth, setCalendarMonth] = useState<Date>(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  // "booked" hides unbooked inquiries and cancelled events; "all" shows
  // everything. Default "booked" — the calendar is an operational surface for
  // scheduled work, not an inquiry triage view. Persisted in localStorage.
  const [calendarFilter, setCalendarFilter] = useState<"all" | "booked">("booked");
  // Selected day on the mobile calendar grid; null = nothing expanded.
  // Reset when the visible month changes.
  const [calendarExpandedDay, setCalendarExpandedDay] = useState<number | null>(null);
  const [weatherMap, setWeatherMap] = useState<Map<string, WeatherForecast>>(new Map());
  const [showShareModal, setShowShareModal] = useState(false);
  const [copied, setCopied] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshMsg, setRefreshMsg] = useState<string | null>(null);
  const shareTextRef = useRef<HTMLTextAreaElement>(null);
  const router = useRouter();
  const searchParams = useSearchParams();

  const today = new Date().toISOString().split("T")[0];

  // Load view mode from localStorage (default: "split").
  // Force-fallback split → list at <sm: split needs desktop width to be
  // useful, and the split toggle button is hidden on mobile anyway.
  useEffect(() => {
    const saved = localStorage.getItem("events_view_mode");
    if (saved !== "calendar" && saved !== "list" && saved !== "split") return;
    const isNarrow = !window.matchMedia("(min-width: 640px)").matches;
    setViewMode(saved === "split" && isNarrow ? "list" : saved);
  }, []);

  // Load calendar filter from localStorage (default: "booked")
  useEffect(() => {
    const saved = localStorage.getItem("events_calendar_filter");
    if (saved === "all") setCalendarFilter("all");
  }, []);

  function handleCalendarFilter(v: "all" | "booked") {
    setCalendarFilter(v);
    localStorage.setItem("events_calendar_filter", v);
  }

  // Auto-open new event dialog if ?new=true
  useEffect(() => {
    if (searchParams.get("new") === "true") {
      setShowForm(true);
    }
  }, [searchParams]);

  // Auto-switch tab if ?tab= is set in URL
  useEffect(() => {
    const tab = searchParams.get("tab") as TabMode | null;
    if (tab) setActiveTab(tab);
  }, [searchParams]);

  function handleViewMode(mode: ViewMode) {
    setViewMode(mode);
    localStorage.setItem("events_view_mode", mode);
  }

  // Upcoming events within 14 days that have a city
  const upcomingWith14DaysAndCity = initialEvents.filter((e) => {
    if (e.event_date < today) return false;
    const diffDays = Math.ceil(
      (new Date(e.event_date + "T00:00:00").getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24)
    );
    return diffDays <= 14 && !!(e.city || e.location);
  });

  // Fetch weather for upcoming events within 14 days
  const fetchWeatherForEvents = useCallback(async () => {
    if (upcomingWith14DaysAndCity.length === 0) return;

    const newMap = new Map<string, WeatherForecast>(weatherMap);

    for (const event of upcomingWith14DaysAndCity) {
      if (newMap.has(event.id)) continue;

      const cityName = event.city ?? event.location;
      if (!cityName) continue;

      try {
        // Geocode the city — fetch top 10 results with US filter, pick highest population
        const geoRes = await fetch(
          `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(normalizeCityForGeocoding(cityName))}&country_code=us&count=10`
        );
        if (!geoRes.ok) continue;
        const geoData = await geoRes.json();
        const results = geoData.results as Array<{ latitude: number; longitude: number; population?: number }> | undefined;
        if (!results || results.length === 0) continue;

        // Pick the highest-population match to avoid small towns over major cities
        const best = results.reduce((a, b) => ((b.population ?? 0) > (a.population ?? 0) ? b : a));
        const { latitude, longitude } = best;

        // Fetch forecast
        const wxRes = await fetch(
          `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&daily=weathercode,temperature_2m_max,temperature_2m_min,precipitation_sum&timezone=auto&start_date=${event.event_date}&end_date=${event.event_date}&temperature_unit=fahrenheit`
        );
        if (!wxRes.ok) continue;
        const wxData = await wxRes.json();

        const daily = wxData.daily as {
          time: string[];
          weathercode: number[];
          temperature_2m_max: number[];
          temperature_2m_min: number[];
        } | undefined;

        if (!daily || !daily.time || daily.time.length === 0) continue;
        const idx = daily.time.indexOf(event.event_date);
        if (idx === -1) continue;

        newMap.set(event.id, {
          wmoCode: daily.weathercode[idx] ?? 0,
          tempHigh: Math.round(daily.temperature_2m_max[idx] ?? 70),
          tempLow: Math.round(daily.temperature_2m_min[idx] ?? 50),
        });
      } catch {
        // silently skip
      }
    }

    setWeatherMap(newMap);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [upcomingWith14DaysAndCity.map((e) => e.id).join(",")]);

  useEffect(() => {
    fetchWeatherForEvents();
  }, [fetchWeatherForEvents]);

  // Get unique years for the year filter
  const years = [
    ...new Set(
      initialEvents.map((e) =>
        new Date(e.event_date + "T00:00:00").getFullYear()
      )
    ),
  ].sort((a, b) => b - a);

  // Split into all / upcoming (booked) / unbooked (future) / past / past_unbooked / flagged / cancelled.
  //
  // initialEvents arrives sorted desc by event_date from the server.
  // That's right for past-focused views (most recent first) but wrong
  // for upcoming-focused views, where the operator wants soonest at
  // the top (what's this week, next week, next month) rather than
  // the furthest-future date first. Re-sort upcoming + unbooked asc.
  const cancelledEvents = initialEvents.filter((e) => !!e.cancellation_reason);
  const upcomingEvents = initialEvents
    .filter((e) => e.event_date >= today && e.booked && !e.cancellation_reason)
    .sort((a, b) => a.event_date.localeCompare(b.event_date));
  const unbookedEvents = initialEvents
    .filter((e) => e.event_date >= today && !e.booked && !e.cancellation_reason)
    .sort((a, b) => a.event_date.localeCompare(b.event_date));
  const pastEvents = initialEvents.filter((e) => e.event_date < today && e.booked && !e.cancellation_reason);
  const pastUnbookedEvents = initialEvents.filter((e) => e.event_date < today && !e.booked && !e.cancellation_reason);
  const flaggedEvents = initialEvents.filter(
    (e) =>
      e.event_date < today &&
      e.booked &&
      !e.cancellation_reason &&                                   // cancelled events don't need sales logged
      e.net_sales === null &&                                    // null only — $0 intentional (charity) is cleared by dismiss
      !(e.event_mode === "catering" && e.invoice_revenue > 0) && // catering with invoice = not missing
      e.anomaly_flag !== "disrupted" &&                          // disrupted = already dismissed
      e.fee_type !== "pre_settled"                               // pre-settled = guaranteed payment, no sales entry needed
  );

  const activeEvents =
    activeTab === "all" ? initialEvents :
    activeTab === "upcoming" ? upcomingEvents :
    activeTab === "unbooked" ? unbookedEvents :
    activeTab === "past_unbooked" ? pastUnbookedEvents :
    activeTab === "flagged" ? flaggedEvents :
    activeTab === "cancelled" ? cancelledEvents :
    pastEvents;

  const filtered = activeEvents.filter((e) => {
    const matchesSearch = e.event_name
      .toLowerCase()
      .includes(search.toLowerCase());
    const matchesYear =
      yearFilter === "all" ||
      new Date(e.event_date + "T00:00:00").getFullYear().toString() === yearFilter;
    const matchesMode =
      modeFilter === "all" || (e.event_mode ?? "food_truck") === modeFilter;
    return matchesSearch && matchesYear && matchesMode;
  });

  // Sort: upcoming/unbooked = ascending (soonest first), all/past/flagged = descending (most recent first)
  const tabDefaultSort: SortDirection = (activeTab === "past" || activeTab === "past_unbooked" || activeTab === "flagged" || activeTab === "all" || activeTab === "cancelled") ? "desc" : "asc";

  const sorted = [...filtered].sort((a, b) => {
    const dir = sortDirection === "asc" ? 1 : -1;

    switch (sortField) {
      case "event_date": {
        const da = new Date(a.event_date + "T00:00:00").getTime();
        const db = new Date(b.event_date + "T00:00:00").getTime();
        return (da - db) * dir;
      }
      case "event_name":
        return a.event_name.localeCompare(b.event_name) * dir;
      case "event_type": {
        const ta = a.event_type ?? "";
        const tb = b.event_type ?? "";
        return ta.localeCompare(tb) * dir;
      }
      case "event_tier": {
        const tierOrder: Record<string, number> = { A: 1, B: 2, C: 3, D: 4 };
        const oa = tierOrder[a.event_tier ?? ""] ?? 5;
        const ob = tierOrder[b.event_tier ?? ""] ?? 5;
        return (oa - ob) * dir;
      }
      case "location": {
        const la = a.location ?? a.city ?? "";
        const lb = b.location ?? b.city ?? "";
        return la.localeCompare(lb) * dir;
      }
      case "net_sales":
      case "net_after_fees":
      case "forecast_sales": {
        const va = a[sortField] ?? -Infinity;
        const vb = b[sortField] ?? -Infinity;
        return (va - vb) * dir;
      }
      case "net_profit": {
        const profitOf = (e: Event) => {
          const hasCost = e.food_cost !== null || e.labor_cost !== null || e.other_costs !== null;
          if (!hasCost) return -Infinity;
          const rev = (e.net_sales ?? 0) + (e.event_mode === "catering" ? (e.invoice_revenue ?? 0) : 0);
          return rev - (e.food_cost ?? 0) - (e.labor_cost ?? 0) - (e.other_costs ?? 0);
        };
        return (profitOf(a) - profitOf(b)) * dir;
      }
      default:
        return 0;
    }
  });

  // When switching tabs, reset sort to default for that tab
  function handleTabChange(tab: TabMode) {
    setActiveTab(tab);
    setSortField("event_date");
    setSortDirection((tab === "past" || tab === "past_unbooked" || tab === "flagged" || tab === "all" || tab === "cancelled") ? "desc" : "asc");
  }

  function handleSort(field: SortField) {
    if (sortField === field) {
      setSortDirection((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      if (field === "event_date") {
        setSortDirection(tabDefaultSort);
      } else {
        setSortDirection("asc");
      }
    }
  }

  function SortIcon({ field }: { field: SortField }) {
    if (sortField !== field) {
      return <ChevronsUpDown className="h-3 w-3 ml-1 opacity-40" />;
    }
    return sortDirection === "asc" ? (
      <ChevronUp className="h-3 w-3 ml-1" />
    ) : (
      <ChevronDown className="h-3 w-3 ml-1" />
    );
  }

  async function handleCreate(data: EventFormData) {
    await createEvent(data);
    router.refresh();
  }

  async function handleUpdate(data: EventFormData) {
    if (!editingEvent) return;
    await updateEvent(editingEvent.id, data);
    setEditingEvent(null);
    router.refresh();
  }

  async function handleDelete(id: string) {
    if (!confirm("Are you sure you want to delete this event?")) return;
    await deleteEvent(id);
    router.refresh();
  }

  async function handleDeleteAll() {
    const count = initialEvents.length;
    if (
      !confirm(
        `Are you sure you want to delete ALL ${count} events? This cannot be undone.`
      )
    )
      return;
    if (
      !confirm(
        `Really delete all ${count} events? Type OK in the next prompt to confirm.`
      )
    )
      return;
    setDeleting(true);
    try {
      await deleteAllEvents();
      router.refresh();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to delete events");
    } finally {
      setDeleting(false);
    }
  }

  async function handleSalesEntry(
    eventId: string,
    netSales: number,
    invoiceRevenue: number,
    weather?: string,
    costs?: { food_cost?: number; labor_cost?: number; other_costs?: number }
  ) {
    const updateData: Partial<EventFormData> = {
      net_sales: netSales,
      invoice_revenue: invoiceRevenue,
    };
    if (weather) updateData.event_weather = weather;
    if (costs) {
      if (costs.food_cost !== undefined) updateData.food_cost = costs.food_cost;
      if (costs.labor_cost !== undefined) updateData.labor_cost = costs.labor_cost;
      if (costs.other_costs !== undefined) updateData.other_costs = costs.other_costs;
    }
    await updateEvent(eventId, updateData);
    router.refresh();
  }

  async function handleQuickBook(event: Event) {
    setBookingId(event.id);
    try {
      await updateEvent(event.id, { booked: true });
      router.refresh();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to book event");
    } finally {
      setBookingId(null);
    }
  }

  async function handleDismiss(eventId: string, reason: "disrupted" | "charity") {
    try {
      await dismissFlaggedEvent(eventId, reason);
      router.refresh();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to dismiss event");
    }
  }

  function handleDuplicate(event: Event) {
    // Build a clean template — copy structure but clear sales, dates, and derived fields
    const template: Event = {
      ...event,
      id: "duplicate", // placeholder; EventForm ignores this on create
      event_date: "",
      net_sales: null,
      invoice_revenue: 0,
      net_after_fees: null,
      forecast_sales: null,
      anomaly_flag: "normal",
    };
    setDuplicatingEvent(template);
  }

  async function handleRefreshForecasts() {
    setRefreshing(true);
    setRefreshMsg(null);
    try {
      const res = await fetch("/api/recalculate", { method: "POST" });
      if (res.ok) {
        const data = await res.json() as { forecastsUpdated?: number };
        setRefreshMsg(`Updated ${data.forecastsUpdated ?? 0} forecast${data.forecastsUpdated === 1 ? "" : "s"}`);
        router.refresh();
      } else {
        setRefreshMsg("Failed — try again");
      }
    } catch {
      setRefreshMsg("Failed — try again");
    } finally {
      setRefreshing(false);
      setTimeout(() => setRefreshMsg(null), 4000);
    }
  }

  function exportCSV() {
    const headers = [
      "Event Name", "Date", "Mode", "Type", "Tier", "Location", "City",
      "Booked", "Cancelled", "Cancellation Reason", "Net Sales", "Invoice Revenue", "After Fees", "Forecast",
      "Food Cost", "Labor Cost", "Other Costs", "Net Profit",
      "Fee Type", "Fee Rate", "Sales Minimum", "Weather", "Anomaly", "Notes",
    ];
    const rows = initialEvents.map((e) => {
      const totalRevenue = (e.net_sales ?? 0) + (e.event_mode === "catering" ? (e.invoice_revenue ?? 0) : 0);
      const totalCosts = (e.food_cost ?? 0) + (e.labor_cost ?? 0) + (e.other_costs ?? 0);
      const hasAnyCost = e.food_cost !== null || e.labor_cost !== null || e.other_costs !== null;
      const netProfit = hasAnyCost ? (e.net_after_fees ?? totalRevenue) - totalCosts : "";
      return [
        e.event_name,
        e.event_date,
        e.event_mode === "catering" ? "Catering" : "Food Truck",
        e.event_type ?? "",
        e.event_tier ?? "",
        e.location ?? "",
        e.city ?? "",
        e.booked ? "Yes" : "No",
        e.cancellation_reason ? "Yes" : "No",
        e.cancellation_reason ?? "",
        e.net_sales ?? "",
        e.invoice_revenue > 0 ? e.invoice_revenue : "",
        e.net_after_fees ?? "",
        e.forecast_sales ?? "",
        e.food_cost ?? "",
        e.labor_cost ?? "",
        e.other_costs ?? "",
        netProfit,
        e.fee_type ?? "",
        e.fee_rate ?? "",
        e.sales_minimum ?? "",
        e.event_weather ?? "",
        e.anomaly_flag ?? "",
        (e.notes ?? "").replace(/"/g, '""'),
      ];
    });

    const csv = [headers, ...rows]
      .map((row) => row.map((cell) => `"${cell}"`).join(","))
      .join("\n");

    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `vendcast-events-${new Date().toISOString().split("T")[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function formatCurrency(val: number | null) {
    if (val === null || val === undefined) return "—";
    return `$${val.toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;
  }

  function formatDate(dateStr: string) {
    return new Date(dateStr + "T00:00:00").toLocaleDateString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  }

  // Build social share text
  function buildShareText(): string {
    const name = businessName || "Our food truck";
    const city = userCity || "";
    const cityTag = city ? `#${city.replace(/\s+/g, "")}FoodTruck` : "#FoodTruck";
    const scheduleUrl = userId ? `vendcast.co/schedule/${userId}` : "vendcast.co";

    const soonestBooked = [...upcomingEvents]
      .sort((a, b) => new Date(a.event_date + "T00:00:00").getTime() - new Date(b.event_date + "T00:00:00").getTime())
      .slice(0, 5);

    const lines = soonestBooked.map((e) => {
      const d = new Date(e.event_date + "T00:00:00");
      const label = d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
      const loc = e.location ?? e.city ?? "TBD";
      return `📅 ${e.event_name} — ${label} at ${loc}`;
    });

    const eventBlock = lines.length > 0 ? lines.join("\n") : "📅 More events coming soon!";

    return `🚚 ${name} is hitting these events soon!\n\n${eventBlock}\n\nFollow our schedule at: ${scheduleUrl}\n#FoodTruck ${cityTag} #StreetFood`;
  }

  async function handleCopyShare() {
    const text = buildShareText();
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // fallback: select textarea
      if (shareTextRef.current) {
        shareTextRef.current.select();
        document.execCommand("copy");
      }
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  // ---- CALENDAR GRID (shared between Calendar view and Split view) ----
  function CalendarGrid() {
    const year = calendarMonth.getFullYear();
    const month = calendarMonth.getMonth();

    const firstDay = new Date(year, month, 1).getDay(); // 0=Sun
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    // Build a grid of 6 rows x 7 cols
    const cells: (number | null)[] = [];
    for (let i = 0; i < firstDay; i++) cells.push(null);
    for (let d = 1; d <= daysInMonth; d++) cells.push(d);
    while (cells.length % 7 !== 0) cells.push(null);

    const monthLabel = calendarMonth.toLocaleString("en-US", {
      month: "long",
      year: "numeric",
    });

    // Events indexed by day, filtered by the "All events / Booked only" toggle.
    // Booked view hides unbooked inquiries and cancelled events so the calendar
    // becomes an at-a-glance view of confirmed commitments.
    const eventsByDay = new Map<number, Event[]>();
    for (const event of initialEvents) {
      if (calendarFilter === "booked") {
        if (!event.booked || event.cancellation_reason) continue;
      }
      const d = new Date(event.event_date + "T00:00:00");
      if (d.getFullYear() === year && d.getMonth() === month) {
        const day = d.getDate();
        if (!eventsByDay.has(day)) eventsByDay.set(day, []);
        eventsByDay.get(day)!.push(event);
      }
    }

    const todayDate = new Date();
    const isCurrentMonth =
      todayDate.getFullYear() === year && todayDate.getMonth() === month;
    const todayDay = isCurrentMonth ? todayDate.getDate() : -1;

    // Build map: day -> event id (for weather lookup)
    // We need to check if any event for that day is in the weatherMap
    function getWeatherForDay(day: number): WeatherForecast | null {
      const dayEvents = eventsByDay.get(day) ?? [];
      for (const event of dayEvents) {
        if (weatherMap.has(event.id)) {
          return weatherMap.get(event.id)!;
        }
      }
      return null;
    }

    function isDayInFuture14(day: number): boolean {
      const cellDate = new Date(year, month, day);
      const now = new Date();
      now.setHours(0, 0, 0, 0);
      const diffMs = cellDate.getTime() - now.getTime();
      const diffDays = diffMs / (1000 * 60 * 60 * 24);
      return diffDays >= 0 && diffDays <= 14;
    }

    function prevMonth() {
      setCalendarMonth(new Date(year, month - 1, 1));
      setCalendarExpandedDay(null);
    }
    function nextMonth() {
      setCalendarMonth(new Date(year, month + 1, 1));
      setCalendarExpandedDay(null);
    }

    // Events to show in the expanded-day section at mobile
    const expandedDayEvents = calendarExpandedDay !== null
      ? eventsByDay.get(calendarExpandedDay) ?? []
      : [];

    return (
      <div className="space-y-4">
        {/* Month navigation + filter toggle */}
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <Button variant="outline" size="icon" onClick={prevMonth}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <h2 className="text-lg font-semibold">{monthLabel}</h2>
          <Button variant="outline" size="icon" onClick={nextMonth}>
            <ChevronRight className="h-4 w-4" />
          </Button>
          <div className="inline-flex rounded-lg border bg-muted p-0.5 text-xs font-medium ml-auto">
            <button
              type="button"
              onClick={() => handleCalendarFilter("all")}
              className={`px-3 py-1.5 rounded-md transition-colors ${
                calendarFilter === "all"
                  ? "bg-background shadow-sm text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              All events
            </button>
            <button
              type="button"
              onClick={() => handleCalendarFilter("booked")}
              className={`px-3 py-1.5 rounded-md transition-colors ${
                calendarFilter === "booked"
                  ? "bg-background shadow-sm text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Booked only
            </button>
          </div>
        </div>

        {/* Mobile grid view (< sm) — real 7-col month grid, tap a day to
            expand that day's events below. Keeps the spatial week-layout
            mental model operators are used to. */}
        <div className="sm:hidden space-y-3">
          <div>
            {/* Day headers */}
            <div className="grid grid-cols-7 text-center text-[10px] font-medium uppercase tracking-wide text-muted-foreground pb-1.5">
              {["S", "M", "T", "W", "T", "F", "S"].map((d, i) => (
                <div key={`m-head-${i}`}>{d}</div>
              ))}
            </div>
            {/* Calendar grid */}
            <div className="grid grid-cols-7 gap-1">
              {cells.map((day, idx) => {
                if (day === null) {
                  return <div key={`m-empty-${idx}`} className="aspect-square" />;
                }
                const dayEvents = eventsByDay.get(day) ?? [];
                const isToday = day === todayDay;
                const isExpanded = calendarExpandedDay === day;
                const hasEvents = dayEvents.length > 0;
                const hasCatering = dayEvents.some((e) => (e.event_mode ?? "food_truck") === "catering");
                return (
                  <button
                    key={`m-day-${day}`}
                    type="button"
                    onClick={() => setCalendarExpandedDay(isExpanded ? null : day)}
                    className={`aspect-square rounded-md border text-xs font-medium flex flex-col items-center justify-center gap-0.5 transition-colors ${
                      isExpanded
                        ? "bg-primary/10 border-primary ring-1 ring-primary"
                        : hasEvents
                          ? "bg-card border-border hover:bg-muted"
                          : "bg-muted/30 border-transparent text-muted-foreground"
                    }`}
                    aria-label={`${day}${hasEvents ? `, ${dayEvents.length} event${dayEvents.length === 1 ? "" : "s"}` : ", no events"}`}
                  >
                    <span
                      className={`leading-none ${
                        isToday
                          ? "bg-primary text-primary-foreground rounded-full h-5 w-5 inline-flex items-center justify-center text-[11px]"
                          : ""
                      }`}
                    >
                      {day}
                    </span>
                    {hasEvents && (
                      <div className="flex items-center gap-0.5">
                        <span
                          className={`h-1.5 w-1.5 rounded-full ${hasCatering ? "bg-violet-500" : "bg-primary"}`}
                        />
                        {dayEvents.length > 1 && (
                          <span className="text-[9px] font-semibold text-muted-foreground leading-none">
                            {dayEvents.length}
                          </span>
                        )}
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Expanded day detail */}
          {calendarExpandedDay !== null && (
            <div className="rounded-lg border bg-card p-3 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-semibold">
                  {new Date(year, month, calendarExpandedDay).toLocaleDateString("en-US", {
                    weekday: "long",
                    month: "short",
                    day: "numeric",
                  })}
                </p>
                <button
                  type="button"
                  onClick={() => setCalendarExpandedDay(null)}
                  className="text-xs text-muted-foreground hover:text-foreground"
                >
                  Close
                </button>
              </div>
              {expandedDayEvents.length === 0 ? (
                <p className="text-xs text-muted-foreground">No events on this day.</p>
              ) : (
                <div className="space-y-1.5">
                  {expandedDayEvents.map((event) => {
                    const isCatering = (event.event_mode ?? "food_truck") === "catering";
                    return (
                      <button
                        key={event.id}
                        onClick={() => setEditingEvent(event)}
                        className={`flex items-start gap-2 w-full text-left rounded-md border bg-background px-3 py-2 hover:bg-muted transition-colors ${
                          isCatering ? "border-l-[3px] border-l-violet-500" : ""
                        }`}
                      >
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium truncate">{event.event_name}</div>
                          {(event.event_type || event.location || event.city) && (
                            <div className="text-xs text-muted-foreground truncate">
                              {[event.event_type, event.location ?? event.city].filter(Boolean).join(" · ")}
                            </div>
                          )}
                        </div>
                        {!event.booked && !event.cancellation_reason && (
                          <Badge variant="outline" className="text-[10px] shrink-0">Unbooked</Badge>
                        )}
                        {event.cancellation_reason && (
                          <Badge variant="outline" className="text-[10px] shrink-0 text-red-600 border-red-300">Cancelled</Badge>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Desktop grid view (>= sm) */}
        <div className="hidden sm:block space-y-2">
          {/* Day headers */}
          <div className="grid grid-cols-7 text-center text-xs font-medium text-muted-foreground border-b pb-2">
            {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
              <div key={d}>{d}</div>
            ))}
          </div>

          {/* Calendar grid */}
          <div className="grid grid-cols-7 gap-px bg-border rounded-lg overflow-hidden">
            {cells.map((day, idx) => {
              if (day === null) {
                return <div key={`empty-${idx}`} className="bg-muted/30 min-h-20 p-1" />;
              }
              const dayEvents = eventsByDay.get(day) ?? [];
              const isToday = day === todayDay;
              const showWeather = isDayInFuture14(day) && dayEvents.length > 0;
              const wx = showWeather ? getWeatherForDay(day) : null;

              return (
                <div
                  key={`day-${day}`}
                  className="bg-card min-h-20 p-1.5 flex flex-col gap-1 relative"
                >
                  {/* Day number */}
                  <span
                    className={`text-xs font-medium self-start leading-none ${
                      isToday
                        ? "bg-primary text-primary-foreground rounded-full px-1.5 py-0.5"
                        : "text-muted-foreground"
                    }`}
                  >
                    {day}
                  </span>

                  {/* Weather in top-right corner */}
                  {wx && (
                    <div className="absolute top-1 right-1 flex items-center gap-0.5">
                      {getWeatherIconSmall(wx.wmoCode)}
                      <span className="text-[9px] text-muted-foreground font-medium leading-none">
                        {wx.tempHigh}°
                      </span>
                    </div>
                  )}

                  {dayEvents.slice(0, 3).map((event) => {
                    const cateringBorderClass = (event.event_mode ?? "food_truck") === "catering"
                      ? "border-l-2 border-l-violet-500"
                      : "border-l-2 border-l-transparent";
                    return (
                      <button
                        key={event.id}
                        onClick={() => setEditingEvent(event)}
                        className={`text-left text-[10px] font-medium px-1 py-0.5 rounded border truncate w-full leading-tight bg-primary/10 text-primary border-primary/20 ${cateringBorderClass} hover:opacity-80 transition-opacity`}
                        title={event.event_name}
                      >
                        {event.event_name}
                      </button>
                    );
                  })}
                  {dayEvents.length > 3 && (
                    <span className="text-[10px] text-muted-foreground pl-1">
                      +{dayEvents.length - 3} more
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    );
  }

  // ---- UPCOMING LIST PANEL (used in Split view right panel) ----
  function UpcomingListPanel() {
    const sortedUpcoming = [...upcomingEvents].sort(
      (a, b) => new Date(a.event_date + "T00:00:00").getTime() - new Date(b.event_date + "T00:00:00").getTime()
    );

    return (
      <div className="flex flex-col h-full">
        <div className="flex items-center gap-2 mb-3 px-1">
          <Calendar className="h-4 w-4 text-muted-foreground" />
          <h3 className="text-sm font-semibold">Upcoming Events</h3>
          <span className="text-xs text-muted-foreground ml-auto">{sortedUpcoming.length} booked</span>
        </div>
        {sortedUpcoming.length === 0 ? (
          <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
            No upcoming booked events.
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto space-y-2 pr-1">
            {sortedUpcoming.map((event) => {
              const wx = weatherMap.get(event.id);
              return (
                <div
                  key={event.id}
                  className="border rounded-lg p-3 bg-card hover:bg-muted/50 transition-colors"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-sm font-medium truncate">{event.event_name}</span>
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {formatDate(event.event_date)}
                      </p>
                      {(event.location || event.city) && (
                        <p className="text-xs text-muted-foreground truncate">
                          {event.location ?? event.city}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      {wx && (
                        <div className="flex items-center gap-0.5 text-xs text-muted-foreground">
                          {getWeatherIconSmall(wx.wmoCode)}
                          <span>{wx.tempHigh}°</span>
                        </div>
                      )}
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        onClick={() => setEditingEvent(event)}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                  {event.forecast_sales && (
                    <div className="mt-1 flex items-center flex-wrap gap-x-2 text-xs text-muted-foreground">
                      <span>Forecast:</span>
                      <ForecastInline event={event} />
                      <WeatherForecastImpact event={event} />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  // ---- CALENDAR VIEW ----
  function CalendarView() {
    return (
      <div className="space-y-4">
        <CalendarGrid />
      </div>
    );
  }

  // ---- WEATHER BADGE ----
  function WeatherBadge({ event }: { event: Event }) {
    const wx = weatherMap.get(event.id);
    if (!wx) return null;
    const { icon, label } = getWeatherInfo(wx.wmoCode);
    return (
      <span
        className="inline-flex items-center gap-1 text-xs text-muted-foreground ml-1"
        title={`${label} · ${wx.tempHigh}°/${wx.tempLow}°F`}
      >
        {icon}
        <span>{wx.tempHigh}°/{wx.tempLow}°</span>
      </span>
    );
  }

  // ---- WEATHER IMPACT ON FORECAST ----
  // Shows a qualitative indicator when weather is meaningfully adjusting an upcoming event's forecast.
  // Uses stored event_weather + known coefficients to infer direction and magnitude.
  function WeatherForecastImpact({ event }: { event: Event }) {
    if (!event.event_weather || !event.forecast_sales || event.forecast_sales <= 0) return null;
    if (event.event_date < today) return null; // only for upcoming events

    const coeff = WEATHER_COEFFICIENTS[event.event_weather];
    if (coeff === undefined || coeff === null) return null;

    // Only show when there's a meaningful deviation (coeff differs from Clear=1.0 by >5%)
    const deviation = Math.abs(coeff - 1.0);
    if (deviation < 0.05) return null;

    // Base forecast without weather would be forecast_sales / coeff
    const baseForecast = event.forecast_sales / coeff;
    const dollarImpact = Math.round(event.forecast_sales - baseForecast);
    const absImpact = Math.abs(dollarImpact);

    // Only show when impact is meaningful: at least $50 AND at least 5% of the forecast
    if (absImpact < 50 || absImpact < event.forecast_sales * 0.05) return null;

    const isNegative = dollarImpact < 0;
    const sign = isNegative ? "-" : "+";
    const color = isNegative ? "text-red-600 dark:text-red-400" : "text-green-600 dark:text-green-400";
    const arrow = isNegative ? "↓" : "↑";

    return (
      <span
        className={`inline-flex items-center gap-0.5 text-xs ${color} ml-1`}
        title={`Weather (${event.event_weather}) adjusting forecast by ${sign}$${absImpact.toLocaleString()} — coefficient: ${coeff}`}
      >
        {arrow} {sign}${absImpact.toLocaleString()} weather
      </span>
    );
  }

  // ---- FORECAST VS ACTUAL ----
  function ForecastVsActual({ event }: { event: Event }) {
    if (
      event.event_date >= today ||
      event.net_sales === null ||
      event.forecast_sales === null ||
      event.forecast_sales <= 0
    ) {
      return null;
    }

    const actual = event.net_sales;
    const forecast = event.forecast_sales;
    const diff = actual - forecast;
    const pct = forecast > 0 ? Math.round((diff / forecast) * 100) : 0;
    const isPositive = diff >= 0;

    return (
      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs">
        <span className="text-muted-foreground">
          Forecast: <span className="font-medium text-foreground">{formatCurrency(forecast)}</span>
        </span>
        <span className={`font-medium ${isPositive ? "text-green-600" : "text-red-600"}`}>
          {isPositive ? "+" : ""}{formatCurrency(diff)} ({isPositive ? "+" : ""}{pct}%)
        </span>
      </div>
    );
  }

  // ---- LIST VIEW ----
  function ListView() {
    return (
      <>
        {/* All / Upcoming / Unbooked / Past / Needs Attention Tabs */}
        <div className="flex gap-1 border-b overflow-x-auto">
          <button
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
              activeTab === "all"
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
            onClick={() => handleTabChange("all")}
          >
            All ({initialEvents.length})
          </button>
          <button
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
              activeTab === "upcoming"
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
            onClick={() => handleTabChange("upcoming")}
          >
            Upcoming ({upcomingEvents.length})
          </button>
          <button
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
              activeTab === "unbooked"
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
            onClick={() => handleTabChange("unbooked")}
          >
            Unbooked ({unbookedEvents.length})
          </button>
          <button
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
              activeTab === "past"
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
            onClick={() => handleTabChange("past")}
          >
            Past ({pastEvents.length})
          </button>
          {pastUnbookedEvents.length > 0 && (
            <button
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                activeTab === "past_unbooked"
                  ? "border-slate-500 text-slate-700 dark:text-slate-300"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
              onClick={() => handleTabChange("past_unbooked")}
            >
              Past Unbooked ({pastUnbookedEvents.length})
            </button>
          )}
          {flaggedEvents.length > 0 && (
            <button
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors flex items-center gap-1.5 whitespace-nowrap ${
                activeTab === "flagged"
                  ? "border-amber-500 text-amber-700 dark:text-amber-400"
                  : "border-transparent text-amber-600 dark:text-amber-500 hover:text-amber-700"
              }`}
              onClick={() => handleTabChange("flagged")}
            >
              Needs Attention
              <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-amber-500 px-1.5 text-[10px] font-bold text-white">
                {flaggedEvents.length}
              </span>
            </button>
          )}
          {cancelledEvents.length > 0 && (
            <button
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                activeTab === "cancelled"
                  ? "border-slate-500 text-slate-700 dark:text-slate-300"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
              onClick={() => handleTabChange("cancelled")}
            >
              Cancelled ({cancelledEvents.length})
            </button>
          )}
        </div>

        {/* Filters */}
        <div className="flex items-center gap-3 flex-wrap">
          <div className="relative flex-1 max-w-sm min-w-48">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search events..."
              className="pl-9"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          {years.length > 1 && (
            <Select value={yearFilter} onValueChange={(val) => setYearFilter(val ?? "all")}>
              <SelectTrigger className="w-28">
                <SelectValue placeholder="Year" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Years</SelectItem>
                {years.map((y) => (
                  <SelectItem key={y} value={y.toString()}>
                    {y}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <div className="flex border rounded-md overflow-hidden text-xs">
            <button
              className={`px-3 py-1.5 font-medium transition-colors ${modeFilter === "all" ? "bg-primary text-primary-foreground" : "bg-background text-muted-foreground hover:text-foreground"}`}
              onClick={() => setModeFilter("all")}
            >All</button>
            <button
              className={`px-3 py-1.5 font-medium transition-colors border-x ${modeFilter === "food_truck" ? "bg-primary text-primary-foreground" : "bg-background text-muted-foreground hover:text-foreground"}`}
              onClick={() => setModeFilter("food_truck")}
            >🚚 Truck</button>
            <button
              className={`px-3 py-1.5 font-medium transition-colors ${modeFilter === "catering" ? "bg-violet-600 text-white" : "bg-background text-muted-foreground hover:text-foreground"}`}
              onClick={() => setModeFilter("catering")}
            >🍽️ Catering</button>
          </div>
          {initialEvents.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="text-destructive hover:text-destructive hover:bg-destructive/10 ml-auto"
              onClick={handleDeleteAll}
              disabled={deleting}
            >
              <Trash2 className="h-4 w-4 mr-1" />
              {deleting ? "Deleting..." : "Delete All"}
            </Button>
          )}
        </div>

        {/* Past Unbooked explanation banner */}
        {activeTab === "past_unbooked" && pastUnbookedEvents.length > 0 && (
          <div className="rounded-lg border border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-900/30 px-4 py-3 text-sm text-slate-700 dark:text-slate-300">
            These events are in your history but were never marked as booked. If they actually happened and you have sales data, click <strong>Edit</strong> → mark as booked → log the sales. If they were tentatives that fell through, you can leave or delete them.
          </div>
        )}

        {/* Events Table */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Calendar className="h-5 w-5" />
              {activeTab === "all" ? "All Events" : activeTab === "upcoming" ? "Upcoming Events" : activeTab === "unbooked" ? "Unbooked Events" : activeTab === "past_unbooked" ? "Past Unbooked Events" : activeTab === "flagged" ? "Events Needing Sales Data" : "Past Events"}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {filtered.length === 0 ? (
              <div className="h-32 flex items-center justify-center text-muted-foreground">
                {initialEvents.length === 0
                  ? "No events yet. Add your first event to get started."
                  : "No events match your search."}
              </div>
            ) : (
              <>
              {/* Mobile card list — replaces the horizontally-scrolling table
                  at <sm. Surfaces the essentials (date, name, location, sales,
                  forecast) with one tap-to-edit target per card. Flagged-tab
                  quick actions (Enter sales / Book it) render as pill buttons
                  below the card body to stay touchable. */}
              <div className="sm:hidden space-y-2">
                {sorted.map((event) => {
                  const isCatering = (event.event_mode ?? "food_truck") === "catering";
                  const displaySales = isCatering && (event.invoice_revenue ?? 0) > 0
                    ? (event.net_sales ?? 0) + (event.invoice_revenue ?? 0)
                    : event.net_sales;
                  const needsSales = event.event_date <= today && !event.net_sales && !event.cancellation_reason && !(isCatering && (event.invoice_revenue ?? 0) > 0);
                  const isUnbookedFuture = !event.booked && event.event_date >= today && !event.cancellation_reason;
                  return (
                    <button
                      key={event.id}
                      type="button"
                      onClick={() => setEditingEvent(event)}
                      className={`w-full text-left rounded-lg border bg-card p-3 hover:bg-muted/50 transition-colors ${
                        isCatering ? "border-l-[3px] border-l-violet-500" :
                        activeTab === "all" && event.booked ? "border-l-[3px] border-l-green-500" :
                        activeTab === "all" && !event.booked ? "border-l-[3px] border-l-slate-300 dark:border-l-slate-600" :
                        ""
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-xs font-medium text-muted-foreground whitespace-nowrap">
                              {formatDate(event.event_date)}
                            </span>
                            {event.cancellation_reason && (
                              <Badge variant="outline" className="text-[10px] text-red-600 border-red-300 dark:text-red-400 dark:border-red-700">
                                Cancelled
                              </Badge>
                            )}
                            {!event.booked && !event.cancellation_reason && (
                              <Badge variant="outline" className="text-[10px]">Unbooked</Badge>
                            )}
                            {event.event_date >= today && weatherMap.has(event.id) && <WeatherBadge event={event} />}
                          </div>
                          <div className="font-medium text-sm mt-1 truncate">{event.event_name}</div>
                          {(event.event_type || event.location || event.city) && (
                            <div className="text-xs text-muted-foreground mt-0.5 truncate">
                              {[event.event_type, event.location ?? event.city].filter(Boolean).join(" · ")}
                            </div>
                          )}
                          <ForecastVsActual event={event} />
                        </div>
                        <div className="text-right shrink-0">
                          <div className="text-sm font-semibold tabular-nums">
                            {formatCurrency(displaySales)}
                            {isCatering && (event.invoice_revenue ?? 0) > 0 && (
                              <span className="text-[10px] text-violet-600 ml-1">inv</span>
                            )}
                          </div>
                          {event.event_date >= today && event.forecast_sales && (
                            <div className="mt-1">
                              <ForecastInline event={event} />
                            </div>
                          )}
                        </div>
                      </div>
                      {(needsSales || isUnbookedFuture) && (
                        <div
                          className="mt-2 pt-2 border-t flex items-center gap-2 flex-wrap"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {isUnbookedFuture && (
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-11 text-xs text-emerald-700 border-emerald-300 hover:bg-emerald-50 dark:text-emerald-400 dark:border-emerald-800"
                              disabled={bookingId === event.id}
                              onClick={() => handleQuickBook(event)}
                            >
                              <BookCheck className="h-3.5 w-3.5 mr-1.5" />
                              {bookingId === event.id ? "Booking..." : "Book it"}
                            </Button>
                          )}
                          {needsSales && (
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-11 text-xs text-green-700 border-green-300 hover:bg-green-50 dark:text-green-400 dark:border-green-800"
                              onClick={() => setSalesEvent(event)}
                            >
                              <DollarSign className="h-3.5 w-3.5 mr-1.5" />
                              {isCatering ? "Log invoice" : "Log sales"}
                            </Button>
                          )}
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>

              <div className="hidden sm:block overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead
                      className="cursor-pointer select-none pr-6 whitespace-nowrap"
                      onClick={() => handleSort("event_date")}
                    >
                      <span className="inline-flex items-center">
                        Date
                        <SortIcon field="event_date" />
                      </span>
                    </TableHead>
                    <TableHead
                      className="cursor-pointer select-none"
                      onClick={() => handleSort("event_name")}
                    >
                      <span className="inline-flex items-center">
                        Event
                        <SortIcon field="event_name" />
                      </span>
                    </TableHead>
                    <TableHead
                      className="hidden md:table-cell cursor-pointer select-none pl-6 pr-4"
                      onClick={() => handleSort("event_type")}
                    >
                      <span className="inline-flex items-center">
                        Type
                        <SortIcon field="event_type" />
                      </span>
                    </TableHead>
                    <TableHead
                      className="hidden xl:table-cell cursor-pointer select-none"
                      onClick={() => handleSort("location")}
                    >
                      <span className="inline-flex items-center">
                        Location
                        <SortIcon field="location" />
                      </span>
                    </TableHead>
                    <TableHead
                      className="cursor-pointer select-none text-right"
                      onClick={() => handleSort("net_sales")}
                    >
                      <span className="inline-flex items-center justify-end">
                        Net Sales
                        <SortIcon field="net_sales" />
                      </span>
                    </TableHead>
                    <TableHead
                      className="hidden md:table-cell cursor-pointer select-none text-right"
                      onClick={() => handleSort("net_after_fees")}
                    >
                      <span className="inline-flex items-center justify-end">
                        After Fees
                        <SortIcon field="net_after_fees" />
                      </span>
                    </TableHead>
                    <TableHead
                      className="hidden lg:table-cell cursor-pointer select-none text-right"
                      onClick={() => handleSort("forecast_sales")}
                    >
                      <span className="inline-flex items-center justify-end">
                        Forecast
                        <SortIcon field="forecast_sales" />
                      </span>
                    </TableHead>
                    <TableHead
                      className="hidden xl:table-cell cursor-pointer select-none text-right"
                      onClick={() => handleSort("net_profit")}
                    >
                      <span className="inline-flex items-center justify-end">
                        Profit
                        <SortIcon field="net_profit" />
                      </span>
                    </TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sorted.map((event) => (
                    <TableRow
                      key={event.id}
                      className={`cursor-pointer hover:bg-muted/50 transition-colors ${
                        (event.event_mode ?? "food_truck") === "catering"
                          ? "border-l-[3px] border-l-violet-500 bg-violet-50/30 dark:bg-violet-950/10"
                          : activeTab === "all"
                            ? event.booked
                              ? "border-l-[3px] border-l-green-500 bg-green-50/40 dark:bg-green-950/10"
                              : "border-l-[3px] border-l-slate-300 dark:border-l-slate-600 bg-slate-50/60 dark:bg-slate-900/20"
                            : ""
                      }`}
                      onClick={() => setEditingEvent(event)}
                    >
                      <TableCell className="whitespace-nowrap text-sm pr-6">
                        {formatDate(event.event_date)}
                        {event.cancellation_reason && (
                          <Badge variant="outline" className="ml-2 text-xs text-red-600 border-red-300 dark:text-red-400 dark:border-red-700">
                            Cancelled
                          </Badge>
                        )}
                        {!event.booked && !event.cancellation_reason && (
                          <Badge variant="outline" className="ml-2 text-xs">
                            Unbooked
                          </Badge>
                        )}
                        {/* Weather badge for upcoming events within 14 days */}
                        {event.event_date >= today && weatherMap.has(event.id) && (
                          <WeatherBadge event={event} />
                        )}
                      </TableCell>
                      <TableCell className="font-medium">
                        <div>{event.event_name}</div>
                        {/* Forecast vs Actual for past events */}
                        <ForecastVsActual event={event} />
                      </TableCell>
                      <TableCell className="hidden md:table-cell text-sm text-muted-foreground pl-6 pr-4">
                        {event.event_type ?? "—"}
                      </TableCell>
                      <TableCell className="hidden xl:table-cell text-sm text-muted-foreground">
                        {event.location ?? event.city ?? "—"}
                      </TableCell>
                      <TableCell className="text-right font-medium">
                        {event.event_mode === "catering" && (event.invoice_revenue ?? 0) > 0 ? (
                          <span title={`Invoice: ${formatCurrency(event.invoice_revenue)}\nOn-site: ${formatCurrency(event.net_sales)}`}>
                            {formatCurrency((event.net_sales ?? 0) + (event.invoice_revenue ?? 0))}
                            <span className="text-[10px] text-violet-600 ml-1">inv</span>
                          </span>
                        ) : (
                          formatCurrency(event.net_sales)
                        )}
                      </TableCell>
                      <TableCell className="hidden md:table-cell text-right text-sm">
                        {formatCurrency(event.net_after_fees)}
                      </TableCell>
                      <TableCell className="hidden lg:table-cell text-right text-sm text-muted-foreground">
                        <ForecastInline event={event} />
                        {event.event_date >= today && (
                          <WeatherForecastImpact event={event} />
                        )}
                      </TableCell>
                      <TableCell className="hidden xl:table-cell text-right text-sm font-medium">
                        {(() => {
                          const hasCost = event.food_cost !== null || event.labor_cost !== null || event.other_costs !== null;
                          if (!hasCost) return <span className="text-muted-foreground">—</span>;
                          const rev = (event.net_sales ?? 0) + (event.event_mode === "catering" ? (event.invoice_revenue ?? 0) : 0);
                          const costs = (event.food_cost ?? 0) + (event.labor_cost ?? 0) + (event.other_costs ?? 0);
                          const p = rev - costs;
                          const margin = rev > 0 ? (p / rev) * 100 : 0;
                          return (
                            <span className={p >= 0 ? "text-green-700 dark:text-green-400" : "text-red-600"} title={`Margin: ${margin.toFixed(1)}%`}>
                              {formatCurrency(p)}
                            </span>
                          );
                        })()}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1 justify-end" onClick={(e) => e.stopPropagation()}>
                          {/* Flagged tab: show dismiss options instead of standard actions */}
                          {activeTab === "flagged" ? (
                            <>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 text-green-600"
                                title="Enter sales"
                                onClick={() => setSalesEvent(event)}
                              >
                                <DollarSign className="h-4 w-4" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-8 px-2 text-xs text-amber-700 hover:text-amber-900 hover:bg-amber-50"
                                title="Dismiss: storm, cancellation, or no-show (excluded from forecasts)"
                                onClick={() => handleDismiss(event.id, "disrupted")}
                              >
                                <CloudLightning className="h-3.5 w-3.5 mr-1" />
                                Disrupted
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-8 px-2 text-xs text-pink-700 hover:text-pink-900 hover:bg-pink-50"
                                title="Dismiss: charity or donated event (logs $0 intentionally)"
                                onClick={() => handleDismiss(event.id, "charity")}
                              >
                                <Heart className="h-3.5 w-3.5 mr-1" />
                                Charity
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8"
                                title="Edit event"
                                onClick={() => setEditingEvent(event)}
                              >
                                <Pencil className="h-4 w-4" />
                              </Button>
                            </>
                          ) : (
                            <>
                              {/* Unbooked events: show "Book It" button */}
                              {!event.booked && event.event_date >= today && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-8 px-2 text-xs text-emerald-700 hover:text-emerald-900 hover:bg-emerald-50 dark:text-emerald-400 dark:hover:bg-emerald-950/30"
                                  title="Mark as booked — moves to Upcoming"
                                  disabled={bookingId === event.id}
                                  onClick={() => handleQuickBook(event)}
                                >
                                  <BookCheck className="h-3.5 w-3.5 mr-1" />
                                  {bookingId === event.id ? "Booking..." : "Book It"}
                                </Button>
                              )}
                              {event.event_date <= today && !event.net_sales && (
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-8 w-8 text-green-600"
                                  title="Enter sales"
                                  onClick={() => setSalesEvent(event)}
                                >
                                  <DollarSign className="h-4 w-4" />
                                </Button>
                              )}
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8"
                                title="Edit event"
                                onClick={() => setEditingEvent(event)}
                              >
                                <Pencil className="h-4 w-4" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 text-muted-foreground hover:text-foreground"
                                title="Duplicate event"
                                onClick={() => handleDuplicate(event)}
                              >
                                <CopyPlus className="h-4 w-4" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 text-destructive"
                                title="Delete event"
                                onClick={() => handleDelete(event.id)}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              </div>
              </>
            )}
          </CardContent>
        </Card>
      </>
    );
  }

  const shareText = buildShareText();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-2xl font-bold">Events</h1>
          <p className="text-muted-foreground">
            {initialEvents.length} total events
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {/* Refresh Forecasts button */}
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="gap-2"
              onClick={handleRefreshForecasts}
              disabled={refreshing}
              title="Recalculate all forecasts and backfill any missing ones"
            >
              <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
              <span className="hidden sm:inline">{refreshing ? "Refreshing…" : "Refresh Forecasts"}</span>
            </Button>
            {refreshMsg && (
              <span className="text-xs text-muted-foreground">{refreshMsg}</span>
            )}
          </div>

          {/* Export CSV button */}
          {initialEvents.length > 0 && (
            <Button
              variant="outline"
              size="sm"
              className="gap-2"
              onClick={exportCSV}
              title="Export all events as CSV"
            >
              <Download className="h-4 w-4" />
              <span className="hidden sm:inline">Export</span>
            </Button>
          )}

          {/* Share button */}
          <Button
            variant="outline"
            size="sm"
            className="gap-2"
            onClick={() => setShowShareModal(true)}
          >
            <Share2 className="h-4 w-4" />
            <span className="hidden sm:inline">Share Schedule</span>
          </Button>

          {/* View toggle: List | Split | Calendar */}
          <div className="flex border rounded-md overflow-hidden">
            <Button
              variant={viewMode === "list" ? "default" : "ghost"}
              size="sm"
              className="rounded-none border-0 px-3"
              onClick={() => handleViewMode("list")}
              title="List view"
            >
              <LayoutList className="h-4 w-4" />
            </Button>
            {/* Split view is desktop-only — neither half gets enough space at <sm */}
            <Button
              variant={viewMode === "split" ? "default" : "ghost"}
              size="sm"
              className="hidden sm:inline-flex rounded-none border-0 px-3"
              onClick={() => handleViewMode("split")}
              title="Split view"
            >
              <Columns2 className="h-4 w-4" />
            </Button>
            <Button
              variant={viewMode === "calendar" ? "default" : "ghost"}
              size="sm"
              className="rounded-none border-0 px-3"
              onClick={() => handleViewMode("calendar")}
              title="Calendar view"
            >
              <CalendarDays className="h-4 w-4" />
            </Button>
          </div>

          <Button className="gap-2" onClick={() => setShowForm(true)}>
            <Plus className="h-4 w-4" />
            Add Event
          </Button>
        </div>
      </div>

      <DataImportTrigger hasEvents={initialEvents.length > 0} />

      {viewMode === "calendar" ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CalendarDays className="h-5 w-5" />
              Calendar
            </CardTitle>
          </CardHeader>
          <CardContent>
            <CalendarView />
          </CardContent>
        </Card>
      ) : viewMode === "split" ? (
        <div className="flex flex-col lg:flex-row gap-4">
          {/* Left: Calendar (~55%) */}
          <div className="lg:w-[55%] min-w-0">
            <Card className="h-full">
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-base">
                  <CalendarDays className="h-4 w-4" />
                  Calendar
                </CardTitle>
              </CardHeader>
              <CardContent>
                <CalendarGrid />
              </CardContent>
            </Card>
          </div>
          {/* Right: Upcoming list (~45%) */}
          <div className="lg:w-[45%] min-w-0">
            <Card className="h-full">
              <CardContent className="pt-4 h-full" style={{ minHeight: "400px" }}>
                <UpcomingListPanel />
              </CardContent>
            </Card>
          </div>
        </div>
      ) : (
        <ListView />
      )}

      {/* Share Schedule Modal */}
      {showShareModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={(e) => { if (e.target === e.currentTarget) setShowShareModal(false); }}
        >
          <div className="bg-background rounded-xl shadow-xl w-full max-w-md p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">Share to Social Media</h2>
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setShowShareModal(false)}>
                ✕
              </Button>
            </div>

            <p className="text-sm text-muted-foreground">
              Paste this into Instagram, Facebook, or X to share your schedule.
            </p>

            <textarea
              ref={shareTextRef}
              readOnly
              className="w-full h-52 rounded-md border bg-muted p-3 text-sm font-mono resize-none focus:outline-none"
              value={shareText}
            />

            <Button
              className="w-full gap-2"
              onClick={handleCopyShare}
            >
              {copied ? (
                <>
                  <Check className="h-4 w-4" />
                  Copied!
                </>
              ) : (
                <>
                  <Copy className="h-4 w-4" />
                  Copy to Clipboard
                </>
              )}
            </Button>
          </div>
        </div>
      )}

      {/* Create Event Dialog */}
      <EventForm
        open={showForm}
        onOpenChange={setShowForm}
        onSubmit={handleCreate}
        profileState={userState}
        recentStates={recentStates}
      />

      {/* Edit Event Dialog — always mounted so Base UI dialog can open/close correctly */}
      <EventForm
        open={!!editingEvent}
        onOpenChange={(open) => !open && setEditingEvent(null)}
        onSubmit={handleUpdate}
        initialData={editingEvent}
        title="Edit Event"
        profileState={userState}
        recentStates={recentStates}
      />

      {/* Duplicate Event Dialog — opens a pre-filled create form with cleared sales/dates */}
      <EventForm
        open={!!duplicatingEvent}
        onOpenChange={(open) => !open && setDuplicatingEvent(null)}
        onSubmit={handleCreate}
        initialData={duplicatingEvent}
        title="Duplicate Event"
        profileState={userState}
        recentStates={recentStates}
      />

      {/* Sales Entry Dialog — always mounted for same reason */}
      <SalesEntryDialog
        open={!!salesEvent}
        onOpenChange={(open) => !open && setSalesEvent(null)}
        event={salesEvent}
        onSubmit={handleSalesEntry}
      />
    </div>
  );
}
