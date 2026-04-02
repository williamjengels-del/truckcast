"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
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
    <div className="min-h-screen bg-gradient-to-b from-gray-50 to-white flex items-center justify-center px-4">
      <div className="max-w-md w-full">
        <div className="text-center mb-6">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-gray-100 mb-4">
            <TruckIcon className="h-7 w-7 text-gray-500" />
          </div>
          <h1 className="text-2xl font-bold text-gray-900">Unsubscribe</h1>
        </div>

        {success ? (
          <div className="bg-white rounded-2xl shadow-sm border border-green-200 p-6 text-center">
            <CheckCircle2 className="h-12 w-12 text-green-500 mx-auto mb-3" />
            <h2 className="text-lg font-semibold text-gray-900 mb-2">
              You've been unsubscribed
            </h2>
            <p className="text-gray-500 text-sm">
              You won't receive any more event notifications.
            </p>
          </div>
        ) : (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6">
            <p className="text-sm text-gray-500 mb-4">
              Enter your email to unsubscribe from event notifications.
            </p>
            <form onSubmit={handleSubmit} className="space-y-3">
              <div>
                <label
                  htmlFor="email"
                  className="block text-sm font-medium text-gray-700 mb-1"
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
                  className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-gray-400 focus:border-transparent"
                />
              </div>
              {error && <p className="text-sm text-red-600">{error}</p>}
              <button
                type="submit"
                disabled={submitting}
                className="w-full bg-gray-800 hover:bg-gray-900 disabled:bg-gray-400 text-white font-medium py-2.5 px-4 rounded-lg transition-colors text-sm"
              >
                {submitting ? "Unsubscribing..." : "Unsubscribe"}
              </button>
            </form>
          </div>
        )}

        <div className="mt-6 text-center">
          <a
            href="https://truckcast.app"
            className="text-xs text-gray-400 hover:text-gray-500 transition-colors"
          >
            Powered by TruckCast
          </a>
        </div>
      </div>
    </div>
  );
}
