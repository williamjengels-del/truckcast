// Audit log for admin mutations. This is the accountability layer for
// service-role operations — NOT a nice-to-have.
//
// Service-role writes bypass RLS and leave no fingerprint in Supabase's
// default auth logs. Without an admin_actions row, a tier change or user
// deletion is invisible at the DB layer: no audit trail, no way to
// reconstruct who did what after the fact. Every mutating admin route
// therefore needs a logAdminAction() call alongside the mutation. Reads
// (GETs) don't need logging; mutations do, unconditionally.
//
// Correctness rules:
//   1. Log AFTER the mutation succeeds, never before.
//   2. If the mutation needs "old value" context for the audit row
//      (e.g. user.tier_change: from -> to), SELECT it BEFORE the
//      mutation, then log AFTER.
//   3. A failed audit write must not roll back the mutation. We log the
//      failure to console.error so it surfaces in Vercel logs, but the
//      admin action proceeds.
//   4. Never invent audit rows for things that might not have happened.
//      Bias the code toward "missing row" over "lying row."

import { headers } from "next/headers";
import { createClient as createServiceClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Action vocabulary. Keep this small and stable — the activity page
 * filters on it and users will learn the names. Add new actions here
 * (rather than inline strings at call sites) so the list stays honest.
 */
export type AdminAction =
  // user.* = actions performed ON another user's account or data
  | "user.delete"
  | "user.tier_change"
  | "user.trial_extend"
  | "user.trial_reset"         // Commit 6
  | "user.import_events"       // Commit 4
  | "user.impersonate_start"   // Commit 5
  | "user.impersonate_end"     // Commit 5
  | "user.event_edit"          // Commit 9
  | "user.event_anomaly_flag"  // Commit 9
  | "user.mfa_reset"           // 2026-04-29 — admin reset of locked-out 2FA
  | "user.cap_override_set"    // 2026-04-29 — Tier-B monthly cap override set/cleared
  | "user.location_edit"       // 2026-05-03 — admin edit of operator city/state
  // testimonial.*
  | "testimonial.create"
  | "testimonial.update"
  | "testimonial.delete"
  // invite.*
  | "invite.generate"
  // feedback.*
  | "feedback.delete"
  // self.* = action on the admin's OWN account (rare, but worth logging
  // so the activity page stays complete)
  | "self.account_reset";

interface LogArgs {
  adminUserId: string;
  action: AdminAction;
  targetType?: "user" | "testimonial" | "invite" | "feedback" | "event" | "self";
  targetId?: string | null;
  metadata?: Record<string, unknown> | null;
}

/**
 * Service-role client used exclusively for audit writes. Callers that
 * already have a service client should pass it in via `logAdminAction`'s
 * overload to avoid a second client instantiation per request.
 */
function getServiceClient(): SupabaseClient {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

/**
 * Write one row to admin_actions. Captures IP + User-Agent from the
 * incoming request headers automatically.
 *
 * Call this AFTER the underlying mutation succeeds, not before — an
 * audit row for a failed action is worse than no row, because the
 * activity page will claim things happened that did not.
 *
 * Audit failures are swallowed (never block the admin action) but
 * logged to console.error so they surface in Vercel logs. If audit
 * writes start failing in prod we want to see it, but we do NOT want
 * to take down the admin tools when the audit table hiccups.
 */
export async function logAdminAction(
  args: LogArgs,
  client?: SupabaseClient
): Promise<void> {
  try {
    const h = await headers();
    const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
    const ua = h.get("user-agent") ?? null;

    const service = client ?? getServiceClient();
    const { error } = await service.from("admin_actions").insert({
      admin_user_id: args.adminUserId,
      action: args.action,
      target_type: args.targetType ?? null,
      target_id: args.targetId ?? null,
      metadata: args.metadata ?? null,
      ip_address: ip,
      user_agent: ua,
    });
    if (error) {
      console.error("admin_audit_log_failed", {
        action: args.action,
        admin_user_id: args.adminUserId,
        error: error.message,
      });
    }
  } catch (err) {
    console.error("admin_audit_log_threw", {
      action: args.action,
      admin_user_id: args.adminUserId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
