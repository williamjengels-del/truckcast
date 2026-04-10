"use client";

import { useState, useEffect, useCallback, useRef } from "react";
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
import { TIER_COLORS } from "@/lib/constants";
import type { Event } from "@/lib/database.types";
import type { EventFormData } from "@/app/dashboard/events/actions";
import { DataImportTrigger } from "@/components/data-import-guide";

type SortField =
  | "event_date"
  | "event_name"
  | "event_type"
  | "event_tier"
  | "location"
  | "net_sales"
  | "net_after_fees"
  | "forecast_sales";
type SortDirection = "asc" | "desc";
type ViewMode = "list" | "split" | "calendar";
type TabMode = "all" | "upcoming" | "unbooked" | "past" | "flagged";

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

// Calendar tier chip colors
const TIER_CHIP_COLORS: Record<string, string> = {
  A: "bg-green-100 text-green-800 border-green-300",
  B: "bg-blue-100 text-blue-800 border-blue-300",
  C: "bg-amber-100 text-amber-800 border-amber-300",
  D: "bg-red-100 text-red-800 border-red-300",
};

export function EventsClient({ initialEvents, userId = "", businessName = "", userCity = "" }: EventsClientProps) {
  const [showForm, setShowForm] = useState(false);
  const [editingEvent, setEditingEvent] = useState<Event | null>(null);
  const [salesEvent, setSalesEvent] = useState<Event | null>(null);
  const [search, setSearch] = useState("");
  const [yearFilter, setYearFilter] = useState<string>("all");
  const [modeFilter, setModeFilter] = useState<"all" | "food_truck" | "catering">("all");
  const [sortField, setSortField] = useState<SortField>("event_date");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const [deleting, setDeleting] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>("split");
  const [activeTab, setActiveTab] = useState<TabMode>("upcoming");
  const [calendarMonth, setCalendarMonth] = useState<Date>(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const [weatherMap, setWeatherMap] = useState<Map<string, WeatherForecast>>(new Map());
  const [showShareModal, setShowShareModal] = useState(false);
  const [copied, setCopied] = useState(false);
  const shareTextRef = useRef<HTMLTextAreaElement>(null);
  const router = useRouter();
  const searchParams = useSearchParams();

  const today = new Date().toISOString().split("T")[0];

  // Load view mode from localStorage (default: "split")
  useEffect(() => {
    const saved = localStorage.getItem("events_view_mode");
    if (saved === "calendar" || saved === "list" || saved === "split") {
      setViewMode(saved);
    }
    // if no saved preference, stay with "split" default
  }, []);

  // Auto-open new event dialog if ?new=true
  useEffect(() => {
    if (searchParams.get("new") === "true") {
      setShowForm(true);
    }
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
        // Geocode the city — fetch top 5 results with US filter, pick highest population
        const geoRes = await fetch(
          `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(cityName)}&country_code=us&count=5`
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

  // Split into all / upcoming (booked) / unbooked (future) / past / flagged
  const upcomingEvents = initialEvents.filter((e) => e.event_date >= today && e.booked);
  const unbookedEvents = initialEvents.filter((e) => e.event_date >= today && !e.booked);
  const pastEvents = initialEvents.filter((e) => e.event_date < today);
  const flaggedEvents = initialEvents.filter(
    (e) =>
      e.event_date < today &&
      e.booked &&
      e.net_sales === null &&           // null only — $0 intentional (charity) is cleared by dismiss
      e.anomaly_flag !== "disrupted" && // disrupted = already dismissed
      e.fee_type !== "pre_settled"      // pre-settled = guaranteed payment, no sales entry needed
  );

  const activeEvents =
    activeTab === "all" ? initialEvents :
    activeTab === "upcoming" ? upcomingEvents :
    activeTab === "unbooked" ? unbookedEvents :
    activeTab === "flagged" ? flaggedEvents :
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
  const tabDefaultSort: SortDirection = (activeTab === "past" || activeTab === "flagged" || activeTab === "all") ? "desc" : "asc";

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
      default:
        return 0;
    }
  });

  // When switching tabs, reset sort to default for that tab
  function handleTabChange(tab: TabMode) {
    setActiveTab(tab);
    setSortField("event_date");
    setSortDirection((tab === "past" || tab === "flagged" || tab === "all") ? "desc" : "asc");
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
    weather?: string
  ) {
    const updateData: Partial<EventFormData> = {
      net_sales: netSales,
      invoice_revenue: invoiceRevenue,
    };
    if (weather) updateData.event_weather = weather;
    await updateEvent(eventId, updateData);
    router.refresh();
  }

  async function handleDismiss(eventId: string, reason: "disrupted" | "charity") {
    try {
      await dismissFlaggedEvent(eventId, reason);
      router.refresh();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to dismiss event");
    }
  }

  function exportCSV() {
    const headers = [
      "Event Name", "Date", "Type", "Tier", "Location", "City",
      "Booked", "Net Sales", "After Fees", "Forecast", "Fee Type",
      "Fee Rate", "Sales Minimum", "Weather", "Anomaly", "Notes",
    ];
    const rows = initialEvents.map((e) => [
      e.event_name,
      e.event_date,
      e.event_type ?? "",
      e.event_tier ?? "",
      e.location ?? "",
      e.city ?? "",
      e.booked ? "Yes" : "No",
      e.net_sales ?? "",
      e.net_after_fees ?? "",
      e.forecast_sales ?? "",
      e.fee_type ?? "",
      e.fee_rate ?? "",
      e.sales_minimum ?? "",
      e.event_weather ?? "",
      e.anomaly_flag ?? "",
      (e.notes ?? "").replace(/"/g, '""'),
    ]);

    const csv = [headers, ...rows]
      .map((row) => row.map((cell) => `"${cell}"`).join(","))
      .join("\n");

    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `truckcast-events-${new Date().toISOString().split("T")[0]}.csv`;
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
    const scheduleUrl = userId ? `truckcast.co/schedule/${userId}` : "truckcast.co";

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

    // Events indexed by day
    const eventsByDay = new Map<number, Event[]>();
    for (const event of initialEvents) {
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
    }
    function nextMonth() {
      setCalendarMonth(new Date(year, month + 1, 1));
    }

    // Build sorted list of days with events for mobile list view
    const daysWithEvents = Array.from(eventsByDay.entries())
      .sort((a, b) => a[0] - b[0]);

    return (
      <div className="space-y-4">
        {/* Month navigation */}
        <div className="flex items-center justify-between">
          <Button variant="outline" size="icon" onClick={prevMonth}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <h2 className="text-lg font-semibold">{monthLabel}</h2>
          <Button variant="outline" size="icon" onClick={nextMonth}>
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>

        {/* Mobile list view (< sm) */}
        <div className="sm:hidden space-y-3">
          {daysWithEvents.length === 0 ? (
            <p className="text-muted-foreground text-sm text-center py-6">No events this month.</p>
          ) : (
            daysWithEvents.map(([day, dayEvents]) => {
              const dateObj = new Date(year, month, day);
              const dateLabel = dateObj.toLocaleDateString("en-US", {
                weekday: "short",
                month: "short",
                day: "numeric",
              });
              const isToday = day === todayDay;
              return (
                <div key={`mobile-day-${day}`} className="space-y-1">
                  <p className={`text-xs font-semibold ${isToday ? "text-primary" : "text-muted-foreground"}`}>
                    {dateLabel}
                  </p>
                  {dayEvents.map((event) => {
                    const chipClass =
                      event.event_tier
                        ? TIER_CHIP_COLORS[event.event_tier] ?? "bg-primary/10 text-primary border-primary/20"
                        : "bg-primary/10 text-primary border-primary/20";
                    return (
                      <button
                        key={event.id}
                        onClick={() => setEditingEvent(event)}
                        className="flex items-center gap-2 w-full text-left rounded-md border bg-card px-3 py-2 hover:bg-muted transition-colors"
                      >
                        <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded border ${chipClass}`}>
                          {event.event_tier ?? "—"}
                        </span>
                        <span className="text-sm font-medium truncate">{event.event_name}</span>
                      </button>
                    );
                  })}
                </div>
              );
            })
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
                    const chipClass =
                      event.event_tier
                        ? TIER_CHIP_COLORS[event.event_tier] ?? "bg-primary/10 text-primary border-primary/20"
                        : "bg-primary/10 text-primary border-primary/20";
                    const cateringBorderClass = (event.event_mode ?? "food_truck") === "catering"
                      ? "border-l-2 border-l-violet-500"
                      : "border-l-2 border-l-transparent";
                    return (
                      <button
                        key={event.id}
                        onClick={() => setEditingEvent(event)}
                        className={`text-left text-[10px] font-medium px-1 py-0.5 rounded border truncate w-full leading-tight ${chipClass} ${cateringBorderClass} hover:opacity-80 transition-opacity`}
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
              const chipClass =
                event.event_tier
                  ? TIER_CHIP_COLORS[event.event_tier] ?? "bg-primary/10 text-primary border-primary/20"
                  : "bg-primary/10 text-primary border-primary/20";
              return (
                <div
                  key={event.id}
                  className="border rounded-lg p-3 bg-card hover:bg-muted/50 transition-colors"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded border ${chipClass}`}>
                          {event.event_tier ?? "—"}
                        </span>
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
                    <p className="text-xs text-muted-foreground mt-1">
                      Forecast: <span className="font-medium text-foreground">{formatCurrency(event.forecast_sales)}</span>
                    </p>
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

        {/* Events Table */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Calendar className="h-5 w-5" />
              {activeTab === "all" ? "All Events" : activeTab === "upcoming" ? "Upcoming Events" : activeTab === "unbooked" ? "Unbooked Events" : activeTab === "flagged" ? "Events Needing Sales Data" : "Past Events"}
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
              <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead
                      className="cursor-pointer select-none"
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
                      className="hidden md:table-cell cursor-pointer select-none"
                      onClick={() => handleSort("event_type")}
                    >
                      <span className="inline-flex items-center">
                        Type
                        <SortIcon field="event_type" />
                      </span>
                    </TableHead>
                    <TableHead
                      className="hidden md:table-cell cursor-pointer select-none"
                      onClick={() => handleSort("event_tier")}
                    >
                      <span className="inline-flex items-center">
                        Tier
                        <SortIcon field="event_tier" />
                      </span>
                    </TableHead>
                    <TableHead
                      className="hidden lg:table-cell cursor-pointer select-none"
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
                      <TableCell className="whitespace-nowrap text-sm">
                        {formatDate(event.event_date)}
                        {!event.booked && (
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
                      <TableCell className="hidden md:table-cell text-sm text-muted-foreground">
                        {event.event_type ?? "—"}
                      </TableCell>
                      <TableCell className="hidden md:table-cell">
                        {event.event_tier ? (
                          <Badge
                            variant="outline"
                            className={TIER_COLORS[event.event_tier] ?? ""}
                          >
                            {event.event_tier}
                          </Badge>
                        ) : (
                          "—"
                        )}
                      </TableCell>
                      <TableCell className="hidden lg:table-cell text-sm text-muted-foreground">
                        {event.location ?? event.city ?? "—"}
                      </TableCell>
                      <TableCell className="text-right font-medium">
                        {formatCurrency(event.net_sales)}
                      </TableCell>
                      <TableCell className="hidden md:table-cell text-right text-sm">
                        {formatCurrency(event.net_after_fees)}
                      </TableCell>
                      <TableCell className="hidden lg:table-cell text-right text-sm text-muted-foreground">
                        {formatCurrency(event.forecast_sales)}
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
            <Button
              variant={viewMode === "split" ? "default" : "ghost"}
              size="sm"
              className="rounded-none border-0 px-3"
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
      />

      {/* Edit Event Dialog — always mounted so Base UI dialog can open/close correctly */}
      <EventForm
        open={!!editingEvent}
        onOpenChange={(open) => !open && setEditingEvent(null)}
        onSubmit={handleUpdate}
        initialData={editingEvent}
        title="Edit Event"
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
