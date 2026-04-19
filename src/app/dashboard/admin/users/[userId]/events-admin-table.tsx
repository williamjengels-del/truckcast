"use client";

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  Pencil,
  Flag,
  Loader2,
  ChevronUp,
  ChevronDown,
  ChevronsUpDown,
  ExternalLink,
} from "lucide-react";
import { EventForm } from "@/components/event-form";
import { Badge } from "@/components/ui/badge";
import type { Event } from "@/lib/database.types";
import type { EventFormData } from "@/app/dashboard/events/actions";

// Admin-side Recent events table on /admin/users/[userId].
//
// Reuses the user-facing EventForm (cleanly decoupled via
// onSubmit + initialData props) but submits to the admin PATCH
// endpoint at /api/admin/events/[eventId].
//
// Current defaults (tuned during Commit 9 smoke-test follow-up):
//   * Server pre-filters to past events only (event_date <= today).
//   * Server sorts by event_date desc and caps at 20 rows.
//   * Client adds click-to-sort on Date / Event / Type / Flag columns.
//   * "View all events" link at the top jumps to the scoped per-user
//     events page at /admin/users/[userId]/events (Commit C). Prior
//     target was /admin/data?business=…; the cross-tenant filter
//     worked but was awkward for per-user operator work (Nick
//     reactivation ~100 rows).
//
// Interactions:
//   Edit — opens EventForm modal with the event; onSubmit PATCHes the
//          admin edit route, closes the modal, router.refresh()es.
//   Flag — one-click normal ↔ disrupted toggle. Boosted stays reachable
//          via the Edit modal; "flag as anomaly" is a quick
//          intervention, not a three-way selector.

type SortField = "event_date" | "event_name" | "event_type" | "anomaly_flag";
type SortDir = "asc" | "desc";

interface Props {
  initialEvents: Event[];
  /** Target user's profile state, for EventForm's state dropdown sort. */
  profileState?: string;
  /** Target user's id — used for the "View all events" link target. */
  userId: string;
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
  // anomaly_flag — normal sorts first, then boosted, then disrupted
  // in asc. desc inverts.
  const order = (v: string | null) =>
    v === "disrupted" ? 2 : v === "boosted" ? 1 : 0;
  return (order(a.anomaly_flag) - order(b.anomaly_flag)) * mult;
}

export function EventsAdminTable({ initialEvents, profileState, userId }: Props) {

  // Distinct states this user's events have used — float to top of
  // EventForm's dropdown below the target's profile state.
  const recentStates = useMemo(() => {
    const seen = new Set<string>();
    for (const e of initialEvents) {
      if (e.state) seen.add(e.state);
    }
    return Array.from(seen);
  }, [initialEvents]);
  const router = useRouter();
  const [events, setEvents] = useState<Event[]>(initialEvents);
  const [editing, setEditing] = useState<Event | null>(null);
  const [flagging, setFlagging] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sortField, setSortField] = useState<SortField>("event_date");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const sortedEvents = useMemo(() => {
    return [...events].sort((a, b) => compareEvents(a, b, sortField, sortDir));
  }, [events, sortField, sortDir]);

  function toggleSort(field: SortField) {
    if (sortField === field) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      // Date defaults to desc (newest first), other columns asc.
      setSortDir(field === "event_date" ? "desc" : "asc");
    }
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
      // Optimistic local update — subsequent router.refresh() reconciles
      // with server truth including the recalculated aggregates.
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

  const viewAllHref = `/dashboard/admin/users/${userId}/events`;

  return (
    <>
      <div className="flex items-center justify-between gap-3 px-4 pt-4 pb-2 flex-wrap">
        <div>
          <h3 className="text-base font-semibold">Recent events</h3>
          <p className="text-xs text-muted-foreground">
            Past events only, newest first. Showing up to 20.
          </p>
        </div>
        <Link
          href={viewAllHref}
          className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
        >
          View all events
          <ExternalLink className="h-3 w-3" />
        </Link>
      </div>

      {error && (
        <div className="mx-4 mb-2 rounded-md bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 p-2 text-xs text-red-800 dark:text-red-200">
          {error}
        </div>
      )}

      {events.length === 0 ? (
        <p className="p-6 text-sm text-muted-foreground">
          No past events found for this user.
        </p>
      ) : (
        <div className="overflow-x-auto border-t">
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
                <th className="px-4 py-2 font-medium text-right">Net sales</th>
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
                <tr key={e.id} className="border-b last:border-b-0">
                  <td className="px-4 py-2 whitespace-nowrap">
                    {formatDate(e.event_date)}
                  </td>
                  <td className="px-4 py-2">{e.event_name ?? "—"}</td>
                  <td className="px-4 py-2 text-muted-foreground">
                    {e.event_type ?? "—"}
                  </td>
                  <td className="px-4 py-2 text-muted-foreground">
                    {e.city
                      ? (e.state ? `${e.city}, ${e.state}` : e.city)
                      : e.location ?? "—"}
                  </td>
                  <td className="px-4 py-2 text-right font-mono">
                    {formatUsd(e.net_sales)}
                  </td>
                  <td className="px-4 py-2 text-center">
                    {e.booked === true ? "✓" : e.booked === false ? "✗" : "—"}
                  </td>
                  <td className="px-4 py-2">{anomalyBadge(e.anomaly_flag) ?? <span className="text-xs text-muted-foreground">—</span>}</td>
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
