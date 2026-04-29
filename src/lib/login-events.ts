import type { SupabaseClient } from "@supabase/supabase-js";

// Login event recording + new-device detection.
//
// Called from the recording endpoint (POST /api/auth/record-login)
// which is hit from both the password-login client flow and the
// OAuth callback. The endpoint owns request parsing (IP, UA, geo)
// and passes structured input here so this module stays pure-data
// and unit-testable.

export const NEW_DEVICE_LOOKBACK_DAYS = 30;

export interface RecordLoginInput {
  userId: string;
  ip: string | null;
  userAgent: string | null;
  country: string | null;
  city: string | null;
  /**
   * For dependency injection in tests — defaults to current time.
   */
  now?: Date;
}

export interface RecordLoginResult {
  isFirstLogin: boolean;
  isNewDevice: boolean;
  /** id of the inserted row, useful for follow-up email send. */
  loginEventId: string | null;
}

/**
 * Detect whether (ip, user_agent) is new for this user — i.e. wasn't
 * seen in the prior NEW_DEVICE_LOOKBACK_DAYS days. A null ip OR null
 * user_agent counts as "missing signal" — we treat that as known
 * (don't fire emails on partial data) to avoid alert noise.
 */
export async function isNewDevice(
  service: SupabaseClient,
  args: { userId: string; ip: string | null; userAgent: string | null; now?: Date }
): Promise<boolean> {
  if (!args.ip || !args.userAgent) return false;

  const cutoff = new Date(args.now ?? Date.now());
  cutoff.setDate(cutoff.getDate() - NEW_DEVICE_LOOKBACK_DAYS);

  const { data } = await service
    .from("profile_login_events")
    .select("id")
    .eq("user_id", args.userId)
    .eq("ip", args.ip)
    .eq("user_agent", args.userAgent)
    .gte("created_at", cutoff.toISOString())
    .limit(1);

  return !data || data.length === 0;
}

/**
 * Returns true when this user has zero prior login_event rows. Used
 * to short-circuit the new-device email — emailing someone about
 * their FIRST sign-in is noise (it's their own action, not a
 * security signal).
 */
export async function isFirstLogin(
  service: SupabaseClient,
  userId: string
): Promise<boolean> {
  const { count } = await service
    .from("profile_login_events")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId);
  return (count ?? 0) === 0;
}

/**
 * Record one login event. Returns flags the caller uses to decide
 * whether to fire the new-device email after returning to the
 * client.
 *
 * Failures are NOT swallowed here — the caller (the recording
 * endpoint) wraps in try/catch and logs to Sentry. Login flow itself
 * never blocks on this; the endpoint returns 200 even if recording
 * fails so the operator can still reach /dashboard.
 */
export async function recordLogin(
  service: SupabaseClient,
  input: RecordLoginInput
): Promise<RecordLoginResult> {
  const firstLogin = await isFirstLogin(service, input.userId);
  // Suppress new-device detection on first-ever login — operator just
  // signed up, the "new device" email would be redundant noise.
  const newDevice = firstLogin
    ? false
    : await isNewDevice(service, {
        userId: input.userId,
        ip: input.ip,
        userAgent: input.userAgent,
        now: input.now,
      });

  const { data, error } = await service
    .from("profile_login_events")
    .insert({
      user_id: input.userId,
      ip: input.ip,
      user_agent: input.userAgent,
      country: input.country,
      city: input.city,
      was_new_device: newDevice,
    })
    .select("id")
    .single();

  if (error) {
    throw new Error(`recordLogin insert failed: ${error.message}`);
  }

  return {
    isFirstLogin: firstLogin,
    isNewDevice: newDevice,
    loginEventId: (data as { id: string } | null)?.id ?? null,
  };
}

/**
 * Mark the new-device email as sent. Service role only.
 */
export async function markNotificationSent(
  service: SupabaseClient,
  loginEventId: string
): Promise<void> {
  const { error } = await service
    .from("profile_login_events")
    .update({ notification_sent_at: new Date().toISOString() })
    .eq("id", loginEventId);
  if (error) {
    // Non-fatal — the email already went out; the timestamp is just
    // for audit. Log so it surfaces in Vercel logs.
    console.error("[login-events] markNotificationSent failed", {
      login_event_id: loginEventId,
      error: error.message,
    });
  }
}

/**
 * Format (city, country) into a human-readable label for the email.
 * Falls back gracefully when geo is missing.
 */
export function formatLocation(
  city: string | null,
  country: string | null
): string {
  if (city && country) return `${city}, ${country}`;
  if (city) return city;
  if (country) return country;
  return "an unknown location";
}

/**
 * Best-effort browser/OS sniff from a UA string, for the email body.
 * The full UA is also surfaced verbatim so there's no ambiguity in
 * case the sniff is wrong.
 */
export function summarizeUserAgent(userAgent: string | null): string {
  if (!userAgent) return "an unknown device";
  // Order matters — Edge UA contains "Chrome", Chrome contains "Safari", etc.
  const ua = userAgent;
  const browser =
    /Edg\//i.test(ua)
      ? "Edge"
      : /Firefox\//i.test(ua)
      ? "Firefox"
      : /Chrome\//i.test(ua)
      ? "Chrome"
      : /Safari\//i.test(ua)
      ? "Safari"
      : "browser";
  const os =
    /iPhone|iPad/i.test(ua)
      ? "iOS"
      : /Macintosh/i.test(ua)
      ? "macOS"
      : /Android/i.test(ua)
      ? "Android"
      : /Windows NT/i.test(ua)
      ? "Windows"
      : /Linux/i.test(ua)
      ? "Linux"
      : "an unknown OS";
  return `${browser} on ${os}`;
}
