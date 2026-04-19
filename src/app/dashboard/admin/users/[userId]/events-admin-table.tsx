"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Flag, Loader2 } from "lucide-react";
import { EventForm } from "@/components/event-form";
import { Badge } from "@/components/ui/badge";
import type { Event } from "@/lib/database.types";
import type { EventFormData } from "@/app/dashboard/events/actions";

// Admin-side "Recent events" table for /admin/users/[userId]. Reuses
// the user-facing EventForm component (cleanly decoupled — accepts
// onSubmit + initialData as props, no auth context inside) but wires
// the submit handler to the admin PATCH endpoint at
// /api/admin/events/[eventId].
//
// Two inline per-row actions:
//   Edit — opens EventForm modal with the full event
//   Flag — one-click toggle: normal ↔ disrupted. Boosted state
//          is reachable via the Edit modal only; "flag as anomaly"
//          is a quick intervention, not a three-way selector.
//
// Audit logs are written server-side:
//   user.event_edit       (changed_fields + event identity)
//   user.event_anomaly_flag (from, to)

interface Props {
  initialEvents: Event[];
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

export function EventsAdminTable({ initialEvents }: Props) {
  const router = useRouter();
  const [events, setEvents] = useState<Event[]>(initialEvents);
  const [editing, setEditing] = useState<Event | null>(null);
  const [flagging, setFlagging] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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
    // EventForm closes itself on successful onSubmit. Refresh the
    // server page so the stats cards + recent events row both pick up
    // the new values.
    setEditing(null);
    router.refresh();
  }

  async function handleToggleFlag(event: Event) {
    setFlagging(event.id);
    setError(null);
    try {
      const nextFlag =
        event.anomaly_flag === "disrupted" ? "normal" : "disrupted";
      const res = await fetch(
        `/api/admin/events/${event.id}/anomaly`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ anomaly_flag: nextFlag }),
        }
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error ?? `Flag failed (HTTP ${res.status})`);
        return;
      }
      // Optimistic local update so the badge flips immediately; the
      // subsequent router.refresh() reconciles with server truth.
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

  if (events.length === 0) {
    return <p className="p-6 text-sm text-muted-foreground">No events yet.</p>;
  }

  return (
    <>
      {error && (
        <div className="mx-4 mt-3 rounded-md bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 p-2 text-xs text-red-800 dark:text-red-200">
          {error}
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b bg-muted/50 text-left">
            <tr>
              <th className="px-4 py-2 font-medium">Date</th>
              <th className="px-4 py-2 font-medium">Event</th>
              <th className="px-4 py-2 font-medium">Type</th>
              <th className="px-4 py-2 font-medium">Location</th>
              <th className="px-4 py-2 font-medium text-right">Net sales</th>
              <th className="px-4 py-2 font-medium text-center">Booked</th>
              <th className="px-4 py-2 font-medium text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {events.map((e) => (
              <tr key={e.id} className="border-b last:border-b-0">
                <td className="px-4 py-2 whitespace-nowrap">
                  {formatDate(e.event_date)}
                </td>
                <td className="px-4 py-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span>{e.event_name ?? "—"}</span>
                    {anomalyBadge(e.anomaly_flag)}
                  </div>
                </td>
                <td className="px-4 py-2 text-muted-foreground">
                  {e.event_type ?? "—"}
                </td>
                <td className="px-4 py-2 text-muted-foreground">
                  {e.city ?? e.location ?? "—"}
                </td>
                <td className="px-4 py-2 text-right font-mono">
                  {formatUsd(e.net_sales)}
                </td>
                <td className="px-4 py-2 text-center">
                  {e.booked === true ? "✓" : e.booked === false ? "✗" : "—"}
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

      <EventForm
        open={!!editing}
        onOpenChange={(open) => {
          if (!open) setEditing(null);
        }}
        onSubmit={handleSave}
        initialData={editing}
        title={editing ? `Edit ${editing.event_name}` : "Edit event"}
      />
    </>
  );
}
