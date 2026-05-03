"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, CheckCircle2 } from "lucide-react";

// Subjects mirror the server-side VALID_SUBJECTS list in
// src/app/api/contact/route.ts. Keep in sync.
const SUBJECTS = [
  "General question",
  "Bug report",
  "Feature request",
  "Billing question",
  "Other",
] as const;

const MIN_MESSAGE = 10;
const MAX_MESSAGE = 2000;

export function ContactForm() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [emailLocked, setEmailLocked] = useState(false); // true when auth-prefilled
  const [subject, setSubject] = useState<string>(SUBJECTS[0]);
  const [message, setMessage] = useState("");
  // Honeypot: hidden field. Bots fill it; humans don't see it. Server
  // returns 200 OK (pretend-success) if populated so bots don't iterate.
  const [website, setWebsite] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Prefill email from the auth session if logged in. Per Julian's
  // spec: prefill AND disable — prevents the confusion of a logged-in
  // user submitting from a different email and Julian replying to the
  // wrong address. Name is NOT prefilled from business_name (business
  // name is the business, not the person). profile.full_name doesn't
  // exist on the schema, so name starts empty.
  useEffect(() => {
    const supabase = createClient();
    let cancelled = false;
    supabase.auth.getUser().then(({ data }) => {
      if (cancelled) return;
      if (data.user?.email) {
        setEmail(data.user.email);
        setEmailLocked(true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);

    // Client-side validation — server enforces the same rules; this
    // is for UX responsiveness, not security.
    const trimmedName = name.trim();
    const trimmedEmail = email.trim();
    const trimmedMessage = message.trim();

    if (!trimmedName) {
      setError("Please add your name.");
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
      setError("Please enter a valid email address.");
      return;
    }
    if (!SUBJECTS.includes(subject as (typeof SUBJECTS)[number])) {
      setError("Please choose a subject.");
      return;
    }
    if (trimmedMessage.length < MIN_MESSAGE) {
      setError(`Message must be at least ${MIN_MESSAGE} characters.`);
      return;
    }
    if (trimmedMessage.length > MAX_MESSAGE) {
      setError(`Message must be under ${MAX_MESSAGE} characters.`);
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: trimmedName,
          email: trimmedEmail,
          subject,
          message: trimmedMessage,
          website, // honeypot — always empty for humans
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
      };
      if (!res.ok || !data.ok) {
        setError(data.error ?? `Couldn't send (HTTP ${res.status}).`);
        return;
      }
      // Success path — clear form (but keep the prefilled + locked
      // email so a logged-in user can send a follow-up without
      // reloading). Confirmation lives in the `success` branch render.
      setSuccess(true);
      setName("");
      setSubject(SUBJECTS[0]);
      setMessage("");
      setWebsite("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error.");
    } finally {
      setSubmitting(false);
    }
  }

  if (success) {
    return (
      <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-6 text-center dark:border-emerald-900 dark:bg-emerald-950/30">
        <CheckCircle2 className="h-10 w-10 text-emerald-600 dark:text-emerald-400 mx-auto mb-3" />
        <h2 className="text-lg font-semibold mb-1">Thanks — message sent.</h2>
        <p className="text-sm text-muted-foreground mb-4">
          We&apos;ll get back to you within 1 business day.
        </p>
        <Button
          variant="outline"
          onClick={() => setSuccess(false)}
          size="sm"
        >
          Send another
        </Button>
      </div>
    );
  }

  const messageLen = message.length;
  const messageCounterColor =
    messageLen > MAX_MESSAGE
      ? "text-destructive"
      : messageLen > MAX_MESSAGE - 100
      ? "text-amber-600"
      : "text-muted-foreground";

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {/* Honeypot — visually hidden but present in the DOM. Bots that
          blindly fill all inputs will populate this; humans never see
          it. Server treats non-empty submission as bot and 200's. */}
      <div
        aria-hidden
        style={{
          position: "absolute",
          left: "-10000px",
          top: "auto",
          width: "1px",
          height: "1px",
          overflow: "hidden",
        }}
      >
        <label htmlFor="website">Website (leave blank)</label>
        <input
          id="website"
          name="website"
          type="text"
          autoComplete="off"
          tabIndex={-1}
          value={website}
          onChange={(e) => setWebsite(e.target.value)}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="name">
          Name <span className="text-destructive">*</span>
        </Label>
        <Input
          id="name"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={200}
          autoComplete="name"
          placeholder="Your name"
          required
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="email">
          Email <span className="text-destructive">*</span>
        </Label>
        <Input
          id="email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          disabled={emailLocked}
          maxLength={320}
          autoComplete="email"
          placeholder="you@example.com"
          required
        />
        {emailLocked && (
          <p className="text-xs text-muted-foreground">
            Using your account email so replies thread back to you.
          </p>
        )}
      </div>

      <div className="space-y-2">
        <Label htmlFor="subject">
          Subject <span className="text-destructive">*</span>
        </Label>
        <Select value={subject} onValueChange={(v) => v && setSubject(v)}>
          <SelectTrigger id="subject">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SUBJECTS.map((s) => (
              <SelectItem key={s} value={s}>
                {s}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label htmlFor="message">
            Message <span className="text-destructive">*</span>
          </Label>
          <span className={`text-xs ${messageCounterColor}`}>
            {messageLen} / {MAX_MESSAGE}
          </span>
        </div>
        <textarea
          id="message"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          rows={6}
          minLength={MIN_MESSAGE}
          maxLength={MAX_MESSAGE}
          required
          className="flex min-h-[120px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
          placeholder="Tell us what's going on…"
        />
      </div>

      {error && (
        <div
          role="alert"
          className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          {error}
        </div>
      )}

      <Button type="submit" className="w-full" disabled={submitting}>
        {submitting ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin mr-2" />
            Sending…
          </>
        ) : (
          "Send message"
        )}
      </Button>
    </form>
  );
}
