"use client";

import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import Image from "next/image";
import { TruckIcon, MapPin, Clock, CheckCircle2 } from "lucide-react";

interface TruckProfile {
  business_name: string | null;
  city: string | null;
  state: string | null;
}

interface UpcomingEvent {
  event_name: string;
  event_date: string;
  start_time: string | null;
  end_time: string | null;
  location: string | null;
  city: string | null;
}

function formatTime(time: string | null): string {
  if (!time) return "";
  const [h, m] = time.split(":");
  const hour = parseInt(h, 10);
  const ampm = hour >= 12 ? "PM" : "AM";
  const display = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
  return `${display}:${m} ${ampm}`;
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr + "T00:00:00");
  return date.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

export default function FollowTruckPage() {
  const params = useParams();
  const userId = params.userId as string;

  const [profile, setProfile] = useState<TruckProfile | null>(null);
  const [events, setEvents] = useState<UpcomingEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        // Fetch profile
        const profileRes = await fetch(`/api/follow/profile?userId=${userId}`);
        if (!profileRes.ok) {
          const data = await profileRes.json();
          setError(data.error || "Truck not found");
          setLoading(false);
          return;
        }
        const profileData = await profileRes.json();
        setProfile(profileData.profile);
        setEvents(profileData.events || []);
      } catch {
        setError("Something went wrong. Please try again.");
      }
      setLoading(false);
    }
    load();
  }, [userId]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setSubmitError(null);

    try {
      const res = await fetch("/api/follow/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, email, name }),
      });
      const data = await res.json();
      if (!res.ok) {
        setSubmitError(data.error || "Failed to subscribe");
      } else {
        setSuccess(true);
      }
    } catch {
      setSubmitError("Something went wrong. Please try again.");
    }
    setSubmitting(false);
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-muted/30 flex items-center justify-center">
        <p className="text-muted-foreground text-lg">Loading...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-muted/30 flex items-center justify-center px-4">
        <div className="text-center">
          <TruckIcon className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
          <p className="text-muted-foreground text-lg">{error}</p>
        </div>
      </div>
    );
  }

  const truckName = profile?.business_name || "This Vendor";
  const location = [profile?.city, profile?.state].filter(Boolean).join(", ");

  return (
    <div className="min-h-screen bg-muted/30">
      <div className="max-w-lg mx-auto px-4 py-8 sm:py-12">
        {/* Header — operator identity is the hero. The TruckIcon
            decorative circle uses brand-teal/10 as a soft brand-presence
            cue without competing with the operator's name. */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-brand-teal/10 mb-4">
            <TruckIcon className="h-8 w-8 text-brand-teal" />
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold text-foreground">
            {truckName}
          </h1>
          {location && (
            <p className="text-muted-foreground mt-1 flex items-center justify-center gap-1">
              <MapPin className="h-4 w-4" />
              {location}
            </p>
          )}
        </div>

        {/* Subscribe form */}
        {success ? (
          <div className="bg-card rounded-2xl shadow-sm border border-green-200 p-6 mb-8 text-center">
            <CheckCircle2 className="h-12 w-12 text-green-500 mx-auto mb-3" />
            <h2 className="text-xl font-semibold text-foreground mb-2">
              You&apos;re subscribed!
            </h2>
            <p className="text-muted-foreground">
              You&apos;ll get notified when {truckName} posts new events. See you there!
            </p>
          </div>
        ) : (
          <div className="bg-card rounded-2xl shadow-sm border border-border p-6 mb-8">
            <h2 className="text-lg font-semibold text-foreground mb-1">
              Get notified about new events
            </h2>
            <p className="text-sm text-muted-foreground mb-4">
              Sign up to know when and where {truckName} will be next.
            </p>
            <form onSubmit={handleSubmit} className="space-y-3">
              <div>
                <label
                  htmlFor="email"
                  className="block text-sm font-medium text-foreground mb-1"
                >
                  Email *
                </label>
                <input
                  id="email"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  className="w-full rounded-lg border border-input bg-background px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-teal focus:border-transparent"
                />
              </div>
              <div>
                <label
                  htmlFor="name"
                  className="block text-sm font-medium text-foreground mb-1"
                >
                  Name (optional)
                </label>
                <input
                  id="name"
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Your name"
                  className="w-full rounded-lg border border-input bg-background px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-teal focus:border-transparent"
                />
              </div>
              {submitError && (
                <p className="text-sm text-destructive">{submitError}</p>
              )}
              <button
                type="submit"
                disabled={submitting}
                className="w-full bg-brand-teal hover:bg-brand-teal/90 disabled:opacity-60 text-white font-medium py-2.5 px-4 rounded-lg transition-colors text-sm"
              >
                {submitting ? "Subscribing..." : "Follow This Schedule"}
              </button>
            </form>
            <p className="text-xs text-muted-foreground mt-3 text-center">
              You can unsubscribe at any time.
            </p>
          </div>
        )}

        {/* Upcoming events — date badges keep brand-orange as the
            accent moment per Verdict #25 (orange = accent + closer;
            teal = default brand presence). */}
        {events.length > 0 && (
          <div>
            <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">
              Upcoming Events
            </h3>
            <div className="space-y-2">
              {events.map((event, i) => {
                const timeRange =
                  event.start_time || event.end_time
                    ? [formatTime(event.start_time), formatTime(event.end_time)]
                        .filter(Boolean)
                        .join(" - ")
                    : null;
                const loc = [event.location, event.city]
                  .filter(Boolean)
                  .join(", ");
                return (
                  <div
                    key={`${event.event_date}-${event.event_name}-${i}`}
                    className="bg-card rounded-xl border border-border p-4 flex items-start gap-3"
                  >
                    <div className="flex-shrink-0 text-center min-w-[3rem]">
                      <div className="text-xs font-semibold text-brand-orange uppercase">
                        {formatDate(event.event_date).split(",")[0]}
                      </div>
                      <div className="text-sm font-bold text-foreground">
                        {formatDate(event.event_date).split(", ").slice(1).join(", ")}
                      </div>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-foreground text-sm truncate">
                        {event.event_name}
                      </p>
                      {timeRange && (
                        <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                          <Clock className="h-3 w-3" />
                          {timeRange}
                        </p>
                      )}
                      {loc && (
                        <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5 truncate">
                          <MapPin className="h-3 w-3 flex-shrink-0" />
                          {loc}
                        </p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Footer — wordmark image as a low-key "powered by" mark.
            Operator identity stays the page's primary signal; the
            wordmark gives interested viewers a path to vendcast.co
            without stealing focus. */}
        <div className="mt-8 flex flex-col items-center gap-1">
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
      </div>
    </div>
  );
}
