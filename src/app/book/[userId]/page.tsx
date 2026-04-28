"use client";

import { useState, use } from "react";
import Image from "next/image";
import { TruckIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createClient } from "@/lib/supabase/client";
import { EVENT_TYPES } from "@/lib/constants";
import { ATTENDANCE_RANGES } from "@/lib/database.types";

export default function BookingPage({ params }: { params: Promise<{ userId: string }> }) {
  const { userId } = use(params);
  const [businessName, setBusinessName] = useState<string | null>(null);
  const [loadingProfile, setLoadingProfile] = useState(true);
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [eventDate, setEventDate] = useState("");
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [eventType, setEventType] = useState("");
  const [location, setLocation] = useState("");
  const [attendanceRange, setAttendanceRange] = useState("");
  const [message, setMessage] = useState("");

  // Load business name
  useState(() => {
    const supabase = createClient();
    supabase
      .from("profiles")
      .select("business_name")
      .eq("id", userId)
      .single()
      .then(({ data }) => {
        setBusinessName(data?.business_name ?? null);
        setLoadingProfile(false);
      });
  });

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);

    // Client-side validation — required fields enforced by the browser
    // (required attribute on inputs) AND by the server route. Belt and
    // braces because HTML required only catches empty-string; we also
    // enforce it in /api/book/submit for safety against API misuse.
    if (!location.trim()) {
      setError("Event location is required.");
      setSubmitting(false);
      return;
    }
    if (!attendanceRange) {
      setError("Expected attendance is required.");
      setSubmitting(false);
      return;
    }
    if (!eventType) {
      setError("Event type is required.");
      setSubmitting(false);
      return;
    }

    try {
      const res = await fetch("/api/book/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          truck_user_id: userId,
          requester_name: name.trim(),
          requester_email: email.trim(),
          requester_phone: phone.trim() || null,
          event_date: eventDate || null,
          start_time: startTime || null,
          end_time: endTime || null,
          event_type: eventType,
          location: location.trim(),
          attendance_range: attendanceRange,
          message: message.trim() || null,
        }),
      });

      setSubmitting(false);
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setError(data.error ?? "Something went wrong. Please try again.");
        return;
      }
      setSubmitted(true);
    } catch {
      setSubmitting(false);
      setError("Network error. Please try again.");
    }
  }

  if (loadingProfile) {
    return (
      <div className="min-h-screen flex items-center justify-center text-muted-foreground">
        Loading...
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-muted/30">
      {/* Header — operator identity is the hero. TruckIcon kept as a
          generic "mobile vendor" decorative cue; in brand-teal so it
          carries the same brand presence as /follow's matching icon
          treatment. */}
      <header className="border-b bg-background">
        <div className="max-w-2xl mx-auto px-4 h-16 flex items-center gap-3">
          <TruckIcon className="h-6 w-6 text-brand-teal" />
          <div>
            <span className="font-bold">{businessName ?? "Vendor"}</span>
            <span className="text-muted-foreground ml-2 text-sm">Request a Booking</span>
          </div>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-10">
        {submitted ? (
          <div className="text-center space-y-4">
            <div className="rounded-full bg-green-100 dark:bg-green-900/30 w-16 h-16 flex items-center justify-center mx-auto">
              <svg className="h-8 w-8 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h1 className="text-2xl font-bold">Request Received!</h1>
            <p className="text-muted-foreground">
              Thanks! We&apos;ll be in touch soon.
            </p>
          </div>
        ) : (
          <div className="space-y-6">
            <div>
              <h1 className="text-2xl font-bold">
                Book {businessName ?? "Us"} for Your Event
              </h1>
              <p className="text-muted-foreground mt-1">
                Fill out the form below and we&apos;ll get back to you to confirm availability.
              </p>
            </div>

            {error && (
              <div className="rounded-md bg-red-50 dark:bg-red-900/20 border border-red-200 p-3 text-sm text-red-800 dark:text-red-200">
                {error}
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4 rounded-lg border bg-card p-6">
              {/* Name + Email */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1">
                  <Label htmlFor="name">Your Name *</Label>
                  <Input
                    id="name"
                    required
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Jane Smith"
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="email">Email Address *</Label>
                  <Input
                    id="email"
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="jane@example.com"
                  />
                </div>
              </div>

              {/* Phone */}
              <div className="space-y-1">
                <Label htmlFor="phone">
                  Phone Number{" "}
                  <span className="text-muted-foreground font-normal">(optional)</span>
                </Label>
                <Input
                  id="phone"
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="(314) 555-0123"
                />
              </div>

              {/* Event date */}
              <div className="space-y-1">
                <Label htmlFor="event-date">Event Date *</Label>
                <Input
                  id="event-date"
                  type="date"
                  required
                  value={eventDate}
                  onChange={(e) => setEventDate(e.target.value)}
                />
              </div>

              {/* Start / end times — side-by-side on sm+, stacked on mobile */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1">
                  <Label htmlFor="start-time">
                    Start Time{" "}
                    <span className="text-muted-foreground font-normal">(optional)</span>
                  </Label>
                  <Input
                    id="start-time"
                    type="time"
                    value={startTime}
                    onChange={(e) => setStartTime(e.target.value)}
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="end-time">
                    End Time{" "}
                    <span className="text-muted-foreground font-normal">(optional)</span>
                  </Label>
                  <Input
                    id="end-time"
                    type="time"
                    value={endTime}
                    onChange={(e) => setEndTime(e.target.value)}
                  />
                </div>
              </div>

              {/* Event type (required dropdown) */}
              <div className="space-y-1">
                <Label htmlFor="event-type">Event Type *</Label>
                <select
                  id="event-type"
                  required
                  className="h-11 md:h-8 w-full rounded-md border border-input bg-background px-3 text-base md:text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  value={eventType}
                  onChange={(e) => setEventType(e.target.value)}
                >
                  <option value="">Select type...</option>
                  {EVENT_TYPES.map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
              </div>

              {/* Location (required) */}
              <div className="space-y-1">
                <Label htmlFor="location">Event Location *</Label>
                <Input
                  id="location"
                  required
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                  placeholder="e.g., Forest Park, Kiener Plaza, 123 Main St"
                />
              </div>

              {/* Attendance range (required dropdown) */}
              <div className="space-y-1">
                <Label htmlFor="attendance-range">Expected Attendance *</Label>
                <select
                  id="attendance-range"
                  required
                  className="h-11 md:h-8 w-full rounded-md border border-input bg-background px-3 text-base md:text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  value={attendanceRange}
                  onChange={(e) => setAttendanceRange(e.target.value)}
                >
                  <option value="">Select a range...</option>
                  {ATTENDANCE_RANGES.map((r) => (
                    <option key={r} value={r}>{r}</option>
                  ))}
                </select>
              </div>

              {/* Message */}
              <div className="space-y-1">
                <Label htmlFor="message">
                  Event Description / Notes{" "}
                  <span className="text-muted-foreground font-normal">(optional)</span>
                </Label>
                <textarea
                  id="message"
                  className="w-full min-h-[100px] rounded-md border border-input bg-background px-3 py-2 text-base md:text-sm resize-y focus:outline-none focus:ring-2 focus:ring-ring"
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder="Tell us about your event, any special requests..."
                />
              </div>

              <Button type="submit" className="w-full" disabled={submitting}>
                {submitting ? "Submitting..." : "Submit Request"}
              </Button>
            </form>
          </div>
        )}

        {/* Footer wordmark — same low-key "powered by" mark as /follow.
            Gives interested viewers a path to vendcast.co without
            stealing focus from the operator's booking flow. */}
        <div className="mt-12 flex justify-center">
          <a
            href="https://vendcast.co"
            className="opacity-50 hover:opacity-80 transition-opacity"
            aria-label="Powered by VendCast — vendcast.co"
          >
            <Image
              src="/vendcast-logo.jpg"
              alt="VendCast"
              width={400}
              height={140}
              className="h-6 w-auto"
            />
          </a>
        </div>
      </main>
    </div>
  );
}
