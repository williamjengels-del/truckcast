"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import Image from "next/image";
import { TruckIcon, CheckCircle2 } from "lucide-react";

export default function UnsubscribePage() {
  const params = useParams();
  const userId = params.userId as string;

  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);

    try {
      const res = await fetch("/api/follow/unsubscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, email }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to unsubscribe");
      } else {
        setSuccess(true);
      }
    } catch {
      setError("Something went wrong. Please try again.");
    }
    setSubmitting(false);
  }

  return (
    <div className="min-h-screen bg-muted/30 flex items-center justify-center px-4">
      <div className="max-w-md w-full">
        {/* Header — muted treatment because this is a destructive
            action; we don't want it to feel "sell-y." */}
        <div className="text-center mb-6">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-muted mb-4">
            <TruckIcon className="h-7 w-7 text-muted-foreground" />
          </div>
          <h1 className="text-2xl font-bold text-foreground">Unsubscribe</h1>
        </div>

        {success ? (
          <div className="bg-card rounded-2xl shadow-sm border border-green-200 p-6 text-center">
            <CheckCircle2 className="h-12 w-12 text-green-500 mx-auto mb-3" />
            <h2 className="text-lg font-semibold text-foreground mb-2">
              You&apos;ve been unsubscribed
            </h2>
            <p className="text-muted-foreground text-sm">
              You won&apos;t receive any more event notifications.
            </p>
          </div>
        ) : (
          <div className="bg-card rounded-2xl shadow-sm border border-border p-6">
            <p className="text-sm text-muted-foreground mb-4">
              Enter your email to unsubscribe from event notifications.
            </p>
            <form onSubmit={handleSubmit} className="space-y-3">
              <div>
                <label
                  htmlFor="email"
                  className="block text-sm font-medium text-foreground mb-1"
                >
                  Email
                </label>
                <input
                  id="email"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  className="w-full rounded-lg border border-input bg-background px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent"
                />
              </div>
              {error && <p className="text-sm text-destructive">{error}</p>}
              {/* Outline-style button — destructive action shouldn't
                  read as a primary call-to-action. */}
              <button
                type="submit"
                disabled={submitting}
                className="w-full border border-input bg-background hover:bg-muted disabled:opacity-60 text-foreground font-medium py-2.5 px-4 rounded-lg transition-colors text-sm"
              >
                {submitting ? "Unsubscribing..." : "Unsubscribe"}
              </button>
            </form>
          </div>
        )}

        {/* Footer wordmark — same low-key "powered by" mark as
            /follow + /book. */}
        <div className="mt-6 flex justify-center">
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
