"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
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
} from "@/app/dashboard/events/actions";
import { TIER_COLORS } from "@/lib/constants";
import type { Event } from "@/lib/database.types";
import type { EventFormData } from "@/app/dashboard/events/actions";

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

interface EventsClientProps {
  initialEvents: Event[];
}

export function EventsClient({ initialEvents }: EventsClientProps) {
  const [showForm, setShowForm] = useState(false);
  const [editingEvent, setEditingEvent] = useState<Event | null>(null);
  const [salesEvent, setSalesEvent] = useState<Event | null>(null);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "upcoming" | "past">("all");
  const [yearFilter, setYearFilter] = useState<string>("all");
  const [sortField, setSortField] = useState<SortField>("event_date");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const [deleting, setDeleting] = useState(false);
  const router = useRouter();

  const today = new Date().toISOString().split("T")[0];

  // Get unique years for the year filter
  const years = [
    ...new Set(
      initialEvents.map((e) =>
        new Date(e.event_date + "T00:00:00").getFullYear()
      )
    ),
  ].sort((a, b) => b - a);

  const filtered = initialEvents.filter((e) => {
    const matchesSearch = e.event_name
      .toLowerCase()
      .includes(search.toLowerCase());
    const matchesFilter =
      filter === "all" ||
      (filter === "upcoming" && e.event_date >= today) ||
      (filter === "past" && e.event_date < today);
    const matchesYear =
      yearFilter === "all" ||
      new Date(e.event_date + "T00:00:00").getFullYear().toString() === yearFilter;
    return matchesSearch && matchesFilter && matchesYear;
  });

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

  function handleSort(field: SortField) {
    if (sortField === field) {
      setSortDirection((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDirection(field === "event_date" ? "desc" : "asc");
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
    weather?: string
  ) {
    const updateData: Partial<EventFormData> = { net_sales: netSales };
    if (weather) updateData.event_weather = weather;
    await updateEvent(eventId, updateData);
    router.refresh();
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

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Events</h1>
          <p className="text-muted-foreground">
            {initialEvents.length} total events
          </p>
        </div>
        <Button className="gap-2" onClick={() => setShowForm(true)}>
          <Plus className="h-4 w-4" />
          Add Event
        </Button>
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
        <div className="flex gap-1">
          {(["all", "upcoming", "past"] as const).map((f) => (
            <Button
              key={f}
              variant={filter === f ? "default" : "outline"}
              size="sm"
              onClick={() => setFilter(f)}
            >
              {f.charAt(0).toUpperCase() + f.slice(1)}
            </Button>
          ))}
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
            {filter === "upcoming"
              ? "Upcoming Events"
              : filter === "past"
                ? "Past Events"
                : "All Events"}
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
                    className="cursor-pointer select-none"
                    onClick={() => handleSort("event_type")}
                  >
                    <span className="inline-flex items-center">
                      Type
                      <SortIcon field="event_type" />
                    </span>
                  </TableHead>
                  <TableHead
                    className="cursor-pointer select-none"
                    onClick={() => handleSort("event_tier")}
                  >
                    <span className="inline-flex items-center">
                      Tier
                      <SortIcon field="event_tier" />
                    </span>
                  </TableHead>
                  <TableHead
                    className="cursor-pointer select-none"
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
                    className="cursor-pointer select-none text-right"
                    onClick={() => handleSort("net_after_fees")}
                  >
                    <span className="inline-flex items-center justify-end">
                      After Fees
                      <SortIcon field="net_after_fees" />
                    </span>
                  </TableHead>
                  <TableHead
                    className="cursor-pointer select-none text-right"
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
                  <TableRow key={event.id}>
                    <TableCell className="whitespace-nowrap text-sm">
                      {formatDate(event.event_date)}
                      {!event.booked && (
                        <Badge variant="outline" className="ml-2 text-xs">
                          Tentative
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="font-medium">
                      {event.event_name}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {event.event_type ?? "—"}
                    </TableCell>
                    <TableCell>
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
                    <TableCell className="text-sm text-muted-foreground">
                      {event.location ?? event.city ?? "—"}
                    </TableCell>
                    <TableCell className="text-right font-medium">
                      {formatCurrency(event.net_sales)}
                    </TableCell>
                    <TableCell className="text-right text-sm">
                      {formatCurrency(event.net_after_fees)}
                    </TableCell>
                    <TableCell className="text-right text-sm text-muted-foreground">
                      {formatCurrency(event.forecast_sales)}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1 justify-end">
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
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Create Event Dialog */}
      <EventForm
        open={showForm}
        onOpenChange={setShowForm}
        onSubmit={handleCreate}
      />

      {/* Edit Event Dialog */}
      {editingEvent && (
        <EventForm
          open={!!editingEvent}
          onOpenChange={(open) => !open && setEditingEvent(null)}
          onSubmit={handleUpdate}
          initialData={editingEvent}
          title="Edit Event"
        />
      )}

      {/* Sales Entry Dialog */}
      {salesEvent && (
        <SalesEntryDialog
          open={!!salesEvent}
          onOpenChange={(open) => !open && setSalesEvent(null)}
          event={salesEvent}
          onSubmit={handleSalesEntry}
        />
      )}
    </div>
  );
}
