"use client";

import { useState, use } from "react";
import { TruckIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createClient } from "@/lib/supabase/client";

const EVENT_TYPES = [
  "Festival",
  "Corporate",
  "Private/Catering",
  "Wedding",
  "Other",
];

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
  const [eventType, setEventType] = useState("");
  const [attendance, setAttendance] = useState("");
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

    // Server route handles the insert (service-role bypass for RLS) and
    // fires a push notification to the operator. Client no longer inserts
    // directly via anon key.
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
          event_type: eventType || null,
          estimated_attendance: attendance ? parseInt(attendance) : null,
          message: message.trim() || null,
        }),
      });

      setSubmitting(false);
      if (!res.ok) {
        setError("Something went wrong. Please try again.");
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
      {/* Header */}
      <header className="border-b bg-background">
        <div className="max-w-2xl mx-auto px-4 h-16 flex items-center gap-3">
          <TruckIcon className="h-6 w-6 text-primary" />
          <div>
            <span className="font-bold">{businessName ?? "Food Truck"}</span>
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

              <div className="space-y-1">
                <Label htmlFor="phone">Phone Number <span className="text-muted-foreground font-normal">(optional)</span></Label>
                <Input
                  id="phone"
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="(314) 555-0123"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1">
                  <Label htmlFor="event-date">Event Date</Label>
                  <Input
                    id="event-date"
                    type="date"
                    value={eventDate}
                    onChange={(e) => setEventDate(e.target.value)}
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="event-type">Event Type</Label>
                  <select
                    id="event-type"
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                    value={eventType}
                    onChange={(e) => setEventType(e.target.value)}
                  >
                    <option value="">Select type...</option>
                    {EVENT_TYPES.map((t) => (
                      <option key={t} value={t}>{t}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="space-y-1">
                <Label htmlFor="attendance">Expected Attendance <span className="text-muted-foreground font-normal">(optional)</span></Label>
                <Input
                  id="attendance"
                  type="number"
                  min={1}
                  value={attendance}
                  onChange={(e) => setAttendance(e.target.value)}
                  placeholder="500"
                />
              </div>

              <div className="space-y-1">
                <Label htmlFor="message">Message / Details <span className="text-muted-foreground font-normal">(optional)</span></Label>
                <textarea
                  id="message"
                  className="w-full min-h-[100px] rounded-md border border-input bg-background px-3 py-2 text-sm resize-y focus:outline-none focus:ring-2 focus:ring-ring"
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder="Tell us about your event, location, and any special requests..."
                />
              </div>

              <Button type="submit" className="w-full" disabled={submitting}>
                {submitting ? "Submitting..." : "Submit Request"}
              </Button>
            </form>
          </div>
        )}
      </main>
    </div>
  );
}
