import { NextResponse } from "next/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { getAdminUser } from "@/lib/admin";

// Admin triage view for Toast unmatched-payment inboxes across all users.
// The per-user inbox at /api/pos/toast/unmatched is scoped via RLS to the
// caller's own rows; this endpoint uses the service role and is admin-gated
// so Julian can see every operator's pending queue at a glance — useful
// when helping an operator resolve something over DM, or spotting a spike
// of unmatched payments that points at a Toast forwarding regression.
//
// Read-only for now. Resolving on behalf of an operator would need them
// to confirm the routing (deposit vs remainder vs dismiss is operator-
// intent) so that belongs in an impersonation flow, not this triage view.

async function getServiceClient() {
  if (!(await getAdminUser())) return null;
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

interface TriageRow {
  id: string;
  user_id: string;
  business_name: string | null;
  email: string | null;
  source: string;
  reported_date: string;
  net_sales: number;
  raw_subject: string | null;
  created_at: string;
}

export async function GET() {
  const service = await getServiceClient();
  if (!service) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { data: payments, error } = await service
    .from("unmatched_toast_payments")
    .select("id, user_id, source, reported_date, net_sales, raw_subject, created_at")
    .is("resolved_at", null)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("[admin/toast-unmatched] list failed:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (!payments || payments.length === 0) {
    return NextResponse.json({ payments: [] satisfies TriageRow[] });
  }

  const userIds = [...new Set(payments.map((p) => p.user_id))];
  const { data: profiles } = await service
    .from("profiles")
    .select("id, business_name")
    .in("id", userIds);
  const businessNameById = new Map<string, string | null>(
    (profiles ?? []).map((p) => [p.id as string, (p.business_name as string | null) ?? null])
  );

  const { data: authData } = await service.auth.admin.listUsers({ perPage: 1000 });
  const emailById = new Map<string, string | null>(
    (authData?.users ?? []).map((u) => [u.id, u.email ?? null])
  );

  const enriched: TriageRow[] = payments.map((p) => ({
    id: p.id as string,
    user_id: p.user_id as string,
    business_name: businessNameById.get(p.user_id as string) ?? null,
    email: emailById.get(p.user_id as string) ?? null,
    source: (p.source as string) ?? "toast",
    reported_date: p.reported_date as string,
    net_sales: Number(p.net_sales),
    raw_subject: (p.raw_subject as string | null) ?? null,
    created_at: p.created_at as string,
  }));

  return NextResponse.json({ payments: enriched });
}
