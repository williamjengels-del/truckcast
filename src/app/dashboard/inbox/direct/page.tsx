"use client";

import { useState, useEffect, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { useImpersonation } from "@/components/impersonation-context";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Copy, Check, RefreshCw, ChevronDown, ChevronUp } from "lucide-react";
import type { BookingRequest } from "@/lib/database.types";

const STATUS_LABELS: Record<BookingRequest["status"], string> = {
  new: "New",
  read: "Read",
  replied: "Replied",
  declined: "Declined",
};

const STATUS_COLORS: Record<BookingRequest["status"], string> = {
  new: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300 border-0",
  read: "bg-muted text-muted-foreground border-0",
  replied: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300 border-0",
  declined: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300 border-0",
};

export default function BookingsPage() {
  // userId comes from impersonation context — the effective user id.
  // During impersonation this is the target's id so copyBookingLink()
  // produces the target's booking URL (correct — admin wants to see
  // what the target's customers see).
  const { effectiveUserId } = useImpersonation();
  const userId = effectiveUserId;

  const [requests, setRequests] = useState<BookingRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Direct Supabase client retained for the status-update mutation
  // only. Mutation is blocked by the Commit 5b proxy during
  // impersonation (expected — admin can't modify target's booking
  // status under read-only impersonation).
  const supabase = createClient();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/dashboard/bookings");
      if (res.ok) {
        const data = (await res.json()) as { bookings: BookingRequest[] };
        setRequests(data.bookings ?? []);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  // Re-fetch when the impersonation scope changes (start or stop).
  // effectiveUserId is the precise signal for scope flips; load itself
  // is useCallback-stable but kept in the deps for lint correctness.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load, effectiveUserId]);

  async function updateStatus(id: string, status: BookingRequest["status"]) {
    setUpdatingId(id);
    await supabase
      .from("booking_requests")
      .update({ status })
      .eq("id", id);
    setUpdatingId(null);
    await load();
  }

  async function copyBookingLink() {
    if (!userId) return;
    const url = `${window.location.origin}/book/${userId}`;
    await navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const newCount = requests.filter((r) => r.status === "new").length;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold">Inbox</h1>
          <p className="text-muted-foreground text-sm">
            Booking inquiries from your public booking page.
          </p>
        </div>
        <Button variant="ghost" size="icon" onClick={load} disabled={loading}>
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
        </Button>
      </div>

      {/* Your booking page link */}
      {userId && (
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center justify-between flex-wrap gap-3">
              <div>
                <p className="text-sm font-medium">Your booking page</p>
                <p className="text-sm text-muted-foreground font-mono">
                  {typeof window !== "undefined"
                    ? `${window.location.origin}/book/${userId}`
                    : `/book/${userId}`}
                </p>
              </div>
              <Button variant="outline" size="sm" className="gap-2" onClick={copyBookingLink}>
                {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                {copied ? "Copied!" : "Copy Link"}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {(["new", "read", "replied", "declined"] as BookingRequest["status"][]).map((s) => (
          <Card key={s}>
            <CardContent className="pt-4">
              <p className="text-2xl font-bold">
                {requests.filter((r) => r.status === s).length}
              </p>
              <p className="text-sm text-muted-foreground">{STATUS_LABELS[s]}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Requests list */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            Inbox
            {newCount > 0 && (
              <Badge className="bg-blue-600 text-white text-xs">{newCount} new</Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-center text-muted-foreground py-8">Loading...</p>
          ) : requests.length === 0 ? (
            <p className="text-center text-muted-foreground py-8">
              No booking requests yet. Share your booking page link to start receiving inquiries.
            </p>
          ) : (
            <div className="space-y-2">
              {requests.map((req) => (
                <div key={req.id} className="rounded-md border overflow-hidden">
                  {/* Row summary */}
                  <button
                    className="w-full text-left px-4 py-3 flex items-center justify-between gap-3 hover:bg-muted/30 transition-colors"
                    onClick={() =>
                      setExpandedId(expandedId === req.id ? null : req.id)
                    }
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <Badge className={`text-xs shrink-0 ${STATUS_COLORS[req.status]}`}>
                        {STATUS_LABELS[req.status]}
                      </Badge>
                      <div className="min-w-0">
                        <span className="font-medium text-sm">{req.requester_name}</span>
                        <span className="text-muted-foreground text-sm ml-2">{req.requester_email}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      {req.event_date && (
                        <span className="text-xs text-muted-foreground">
                          {new Date(req.event_date + "T00:00:00").toLocaleDateString("en-US", {
                            month: "short",
                            day: "numeric",
                            year: "numeric",
                          })}
                        </span>
                      )}
                      <span className="text-xs text-muted-foreground">
                        {new Date(req.created_at).toLocaleDateString()}
                      </span>
                      {expandedId === req.id ? (
                        <ChevronUp className="h-4 w-4 text-muted-foreground" />
                      ) : (
                        <ChevronDown className="h-4 w-4 text-muted-foreground" />
                      )}
                    </div>
                  </button>

                  {/* Expanded details */}
                  {expandedId === req.id && (
                    <div className="border-t px-4 py-4 space-y-4 bg-muted/20">
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
                        <div>
                          <p className="text-xs text-muted-foreground uppercase tracking-wide mb-0.5">Name</p>
                          <p>{req.requester_name}</p>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground uppercase tracking-wide mb-0.5">Email</p>
                          <a href={`mailto:${req.requester_email}`} className="text-primary hover:underline">
                            {req.requester_email}
                          </a>
                        </div>
                        {req.requester_phone && (
                          <div>
                            <p className="text-xs text-muted-foreground uppercase tracking-wide mb-0.5">Phone</p>
                            <p>{req.requester_phone}</p>
                          </div>
                        )}
                        {req.event_date && (
                          <div>
                            <p className="text-xs text-muted-foreground uppercase tracking-wide mb-0.5">Event Date</p>
                            <p>{new Date(req.event_date + "T00:00:00").toLocaleDateString("en-US", {
                              weekday: "short",
                              month: "long",
                              day: "numeric",
                              year: "numeric",
                            })}</p>
                          </div>
                        )}
                        {req.event_type && (
                          <div>
                            <p className="text-xs text-muted-foreground uppercase tracking-wide mb-0.5">Event Type</p>
                            <p>{req.event_type}</p>
                          </div>
                        )}
                        {req.estimated_attendance && (
                          <div>
                            <p className="text-xs text-muted-foreground uppercase tracking-wide mb-0.5">Attendance</p>
                            <p>{req.estimated_attendance.toLocaleString()}</p>
                          </div>
                        )}
                      </div>

                      {req.message && (
                        <div>
                          <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Message</p>
                          <p className="text-sm whitespace-pre-wrap">{req.message}</p>
                        </div>
                      )}

                      {/* Status actions */}
                      <div className="flex gap-2 flex-wrap">
                        {req.status === "new" && (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={updatingId === req.id}
                            onClick={() => updateStatus(req.id, "read")}
                          >
                            Mark as Read
                          </Button>
                        )}
                        {req.status !== "replied" && (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={updatingId === req.id}
                            onClick={() => updateStatus(req.id, "replied")}
                          >
                            Mark Replied
                          </Button>
                        )}
                        {req.status !== "declined" && (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={updatingId === req.id}
                            onClick={() => updateStatus(req.id, "declined")}
                          >
                            Decline
                          </Button>
                        )}
                        {req.status !== "new" && (
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={updatingId === req.id}
                            onClick={() => updateStatus(req.id, "new")}
                          >
                            Reset to New
                          </Button>
                        )}
                        <a href={`mailto:${req.requester_email}`}>
                          <Button size="sm" variant="default">
                            Reply via Email
                          </Button>
                        </a>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
