"use client";

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import {
  Pencil,
  Flag,
  Loader2,
  ChevronUp,
  ChevronDown,
  ChevronsUpDown,
  Search,
} from "lucide-react";
import { EventForm } from "@/components/event-form";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { Event } from "@/lib/database.types";
import type { EventFormData } from "@/app/dashboard/events/actions";

// Per-user events page client. Companion to ./page.tsx.
//
// Deliberately self-contained rather than generalising events-admin-table
// — the recent-events card on the user detail page has tight constraints
// (20 rows, past-only, no search) that don't apply here, and forcing both
// surfaces through one component would either over-conditionalize the
// table or bloat props. If we add a third consumer we extract then.
//
// Filters (all client-side over the full initial list):
//   * Year — derived from the actual event dates. "All years" is the
//     default; this matters when a user has events across 3+ seasons
//     (Wok-O Taco shape, ~100 events/year).
//   * Event type — derived from the distinct types present in the data.
//     Stays out of the way when the user only has one type.
//   * Booked — all / booked only / unbooked only.
//   * Search — matches event_name, location, city (case-insensitive).
//
// Sort: click any of Date / Event / Type / Net sales / Flag. Date defaults
// to desc on first render (newest first — this is a review surface, not
// an upcoming-calendar surface; see events-client.tsx for the inverse
// default on the user-facing page).
//
// Actions: reuses the same PATCH /api/admin/events/[eventId] and
// PATCH /api/admin/events/[eventId]/anomaly endpoints as the recent-
// events card on the user detail page. EventForm is reused as the edit
// modal.

type SortField =
  | "event_date"
  | "event_name"
  | "event_type"
  | "net_sales"
  | "anomaly_flag";
type SortDir = "asc" | "desc";

interface Props {
  initialEvents: Event[];
  businessName: string;
  profileState?: string;
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso + "T00:00:00").toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function formatUsd(n: number | null | undefined): string {
  if (n == null) return "—";
  return `$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

function anomalyBadge(flag: string | null) {
  const value = flag ?? "normal";
  if (value === "disrupted") {
    return (
      <Badge variant="outline" className="text-amber-700 border-amber-300 dark:text-amber-400">
        disrupted
      </Badge>
    );
  }
  if (value === "boosted") {
    return (
      <Badge variant="outline" className="text-purple-700 border-purple-300 dark:text-purple-400">
        boosted
      </Badge>
    );
  }
  return null;
}

function SortIcon({
  field,
  activeField,
  dir,
}: {
  field: SortField;
  activeField: SortField;
  dir: SortDir;
}) {
  if (field !== activeField) {
    return <ChevronsUpDown className="h-3 w-3 ml-1 opacity-40 inline-block" />;
  }
  return dir === "asc" ? (
    <ChevronUp className="h-3 w-3 ml-1 text-primary inline-block" />
  ) : (
    <ChevronDown className="h-3 w-3 ml-1 text-primary inline-block" />
  );
}

function compareEvents(a: Event, b: Event, field: SortField, dir: SortDir): number {
  const mult = dir === "asc" ? 1 : -1;
  if (field === "event_date") {
    return (a.event_date ?? "").localeCompare(b.event_date ?? "") * mult;
  }
  if (field === "event_name") {
    return (a.event_name ?? "").localeCompare(b.event_name ?? "") * mult;
  }
  if (field === "event_type") {
    return (a.event_type ?? "").localeCompare(b.event_type ?? "") * mult;
  }
  if (field === "net_sales") {
    // Nulls sort last in asc (i.e. unreported events drift to bottom
    // when user sorts low-to-high); flip to first in desc so the
    // "highest first" view shows actual reported numbers at the top.
    const va = a.net_sales ?? (dir === "asc" ? Infinity : -Infinity);
    const vb = b.net_sales ?? (dir === "asc" ? Infinity : -Infinity);
    return (va - vb) * mult;
  }
  // anomaly_flag — normal sorts first, then boosted, then disrupted in asc.
  const order = (v: string | null) =>
    v === "disrupted" ? 2 : v === "boosted" ? 1 : 0;
  return (order(a.anomaly_flag) - order(b.anomaly_flag)) * mult;
}

export function EventsPageClient({ initialEvents, businessName: _businessName, profileState }: Props) {
  void _businessName; // retained in props for parity / future header use
  const router = useRouter();
  const [events, setEvents] = useState<Event[]>(initialEvents);
  const [editing, setEditing] = useState<Event | null>(null);
  const [flagging, setFlagging] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [search, setSearch] = useState("");
  const [yearFilter, setYearFilter] = useState<string>("all");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [bookedFilter, setBookedFilter] = useState<string>("all");

  // Sort — newest-first on initial render. Review surface, not calendar.
  const [sortField, setSortField] = useState<SortField>("event_date");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  // Derived filter options.
  const availableYears = useMemo(() => {
    const seen = new Set<number>();
    for (const e of events) {
      if (!e.event_date) continue;
      seen.add(new Date(e.event_date + "T00:00:00").getFullYear());
    }
    return Array.from(seen).sort((a, b) => b - a);
  }, [events]);

  const availableTypes = useMemo(() => {
    const seen = new Set<string>();
    for (const e of events) {
      if (e.event_type) seen.add(e.event_type);
    }
    return Array.from(seen).sort();
  }, [events]);

  // Distinct states this user's events have used — float to top of
  // EventForm's dropdown below the target's profile state (mirror of
  // events-admin-table.tsx).
  const recentStates = useMemo(() => {
    const seen = new Set<string>();
    for (const e of events) {
      if (e.state) seen.add(e.state);
    }
    return Array.from(seen);
  }, [events]);

  const filteredEvents = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return events.filter((e) => {
      if (yearFilter !== "all") {
        if (!e.event_date) return false;
        const y = new Date(e.event_date + "T00:00:00").getFullYear().toString();
        if (y !== yearFilter) return false;
      }
      if (typeFilter !== "all" && (e.event_type ?? "") !== typeFilter) {
        return false;
      }
      if (bookedFilter === "booked" && e.booked !== true) return false;
      if (bookedFilter === "unbooked" && e.booked !== false) return false;
      if (needle) {
        const hay = [e.event_name, e.location, e.city]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
  }, [events, search, yearFilter, typeFilter, bookedFilter]);

  const sortedEvents = useMemo(() => {
    return [...filteredEvents].sort((a, b) =>
      compareEvents(a, b, sortField, sortDir)
    );
  }, [filteredEvents, sortField, sortDir]);

  function toggleSort(field: SortField) {
    if (sortField === field) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      // Date + net_sales default to desc (newest/highest first).
      // Textual fields default to asc.
      setSortDir(field === "event_date" || field === "net_sales" ? "desc" : "asc");
    }
  }

  const hasActiveFilters =
    search !== "" ||
    yearFilter !== "all" ||
    typeFilter !== "all" ||
    bookedFilter !== "all";

  function clearFilters() {
    setSearch("");
    setYearFilter("all");
    setTypeFilter("all");
    setBookedFilter("all");
  }

  async function handleSave(data: EventFormData) {
    if (!editing) return;
    const res = await fetch(`/api/admin/events/${editing.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ formData: data }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error ?? `Save failed (HTTP ${res.status})`);
    }
    setEditing(null);
    router.refresh();
  }

  async function handleToggleFlag(event: Event) {
    setFlagging(event.id);
    setError(null);
    try {
      const nextFlag =
        event.anomaly_flag === "disrupted" ? "normal" : "disrupted";
      const res = await fetch(`/api/admin/events/${event.id}/anomaly`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ anomaly_flag: nextFlag }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error ?? `Flag failed (HTTP ${res.status})`);
        return;
      }
      // Optimistic local update — server recalcs aggregates async via
      // after(); router.refresh() pulls the reconciled state.
      setEvents((prev) =>
        prev.map((e) => (e.id === event.id ? { ...e, anomaly_flag: nextFlag } : e))
      );
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
    } finally {
      setFlagging(null);
    }
  }

  return (
    <>
      {/* Filter bar */}
      <div className="flex flex-wrap gap-3 items-end">
        <div className="flex flex-col gap-1 min-w-[12rem] flex-1">
          <label className="text-xs text-muted-foreground font-medium">Search</label>
          <div className="relative">
            <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Event name, location, city…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-8"
            />
          </div>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted-foreground font-medium">Year</label>
          <Select
            value={yearFilter}
            onValueChange={(v) => v && setYearFilter(v)}
          >
            <SelectTrigger className="w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All years</SelectItem>
              {availableYears.map((y) => (
                <SelectItem key={y} value={String(y)}>
                  {y}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {availableTypes.length > 1 && (
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground font-medium">Type</label>
            <Select
              value={typeFilter}
              onValueChange={(v) => v && setTypeFilter(v)}
            >
              <SelectTrigger className="w-44">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All types</SelectItem>
                {availableTypes.map((t) => (
                  <SelectItem key={t} value={t}>
                    {t}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted-foreground font-medium">Booked</label>
          <Select
            value={bookedFilter}
            onValueChange={(v) => v && setBookedFilter(v)}
          >
            <SelectTrigger className="w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="booked">Booked only</SelectItem>
              <SelectItem value="unbooked">Unbooked only</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {hasActiveFilters && (
          <button
            type="button"
            onClick={clearFilters}
            className="text-xs text-muted-foreground hover:text-foreground underline pb-2"
          >
            Clear filters
          </button>
        )}
      </div>

      <p className="text-xs text-muted-foreground">
        Showing {sortedEvents.length} of {events.length} event
        {events.length === 1 ? "" : "s"}
        {hasActiveFilters ? " (filtered)" : ""}.
      </p>

      {error && (
        <div className="rounded-md bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 p-2 text-xs text-red-800 dark:text-red-200">
          {error}
        </div>
      )}

      {events.length === 0 ? (
        <p className="rounded-md border p-6 text-sm text-muted-foreground">
          This user has no events yet.
        </p>
      ) : sortedEvents.length === 0 ? (
        <p className="rounded-md border p-6 text-sm text-muted-foreground">
          No events match the current filters.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/50 text-left">
              <tr>
                <th className="px-4 py-2 font-medium">
                  <button
                    type="button"
                    onClick={() => toggleSort("event_date")}
                    className="inline-flex items-center hover:text-foreground"
                  >
                    Date
                    <SortIcon field="event_date" activeField={sortField} dir={sortDir} />
                  </button>
                </th>
                <th className="px-4 py-2 font-medium">
                  <button
                    type="button"
                    onClick={() => toggleSort("event_name")}
                    className="inline-flex items-center hover:text-foreground"
                  >
                    Event
                    <SortIcon field="event_name" activeField={sortField} dir={sortDir} />
                  </button>
                </th>
                <th className="px-4 py-2 font-medium">
                  <button
                    type="button"
                    onClick={() => toggleSort("event_type")}
                    className="inline-flex items-center hover:text-foreground"
                  >
                    Type
                    <SortIcon field="event_type" activeField={sortField} dir={sortDir} />
                  </button>
                </th>
                <th className="px-4 py-2 font-medium">Location</th>
                <th className="px-4 py-2 font-medium text-right">
                  <button
                    type="button"
                    onClick={() => toggleSort("net_sales")}
                    className="inline-flex items-center ml-auto hover:text-foreground"
                  >
                    Net sales
                    <SortIcon field="net_sales" activeField={sortField} dir={sortDir} />
                  </button>
                </th>
                <th className="px-4 py-2 font-medium text-center">Booked</th>
                <th className="px-4 py-2 font-medium">
                  <button
                    type="button"
                    onClick={() => toggleSort("anomaly_flag")}
                    className="inline-flex items-center hover:text-foreground"
                  >
                    Flag
                    <SortIcon field="anomaly_flag" activeField={sortField} dir={sortDir} />
                  </button>
                </th>
                <th className="px-4 py-2 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {sortedEvents.map((e) => (
                <tr key={e.id} className="border-b last:border-b-0 hover:bg-muted/30">
                  <td className="px-4 py-2 whitespace-nowrap">
                    {formatDate(e.event_date)}
                  </td>
                  <td className="px-4 py-2 max-w-[240px]">
                    <div className="truncate" title={e.event_name ?? undefined}>
                      {e.event_name ?? "—"}
                    </div>
                  </td>
                  <td className="px-4 py-2 text-muted-foreground">
                    {e.event_type ?? "—"}
                  </td>
                  <td className="px-4 py-2 text-muted-foreground">
                    {e.city
                      ? e.state
                        ? `${e.city}, ${e.state}`
                        : e.city
                      : e.location ?? "—"}
                  </td>
                  <td className="px-4 py-2 text-right font-mono">
                    {formatUsd(e.net_sales)}
                  </td>
                  <td className="px-4 py-2 text-center">
                    {e.booked === true ? "✓" : e.booked === false ? "✗" : "—"}
                  </td>
                  <td className="px-4 py-2">
                    {anomalyBadge(e.anomaly_flag) ?? (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-right whitespace-nowrap">
                    <div className="inline-flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => setEditing(e)}
                        className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
                        title="Edit event"
                      >
                        <Pencil className="h-3 w-3" />
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => handleToggleFlag(e)}
                        disabled={flagging === e.id}
                        className={`inline-flex items-center gap-1 rounded px-2 py-1 text-xs hover:bg-muted ${
                          e.anomaly_flag === "disrupted"
                            ? "text-amber-700 dark:text-amber-400"
                            : "text-muted-foreground hover:text-foreground"
                        } disabled:opacity-60`}
                        title={
                          e.anomaly_flag === "disrupted"
                            ? "Clear disrupted flag"
                            : "Flag as disrupted"
                        }
                      >
                        {flagging === e.id ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <Flag className="h-3 w-3" />
                        )}
                        {e.anomaly_flag === "disrupted" ? "Unflag" : "Flag"}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <EventForm
        open={!!editing}
        onOpenChange={(open) => {
          if (!open) setEditing(null);
        }}
        onSubmit={handleSave}
        initialData={editing}
        title={editing ? `Edit ${editing.event_name}` : "Edit event"}
        profileState={profileState}
        recentStates={recentStates}
      />
    </>
  );
}
