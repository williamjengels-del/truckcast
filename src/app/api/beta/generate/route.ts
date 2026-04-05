import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";

// Julian's email — only he can generate invite codes
const ADMIN_EMAIL = "williamjengels@gmail.com";

function getServiceClient() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

function generateCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I ambiguity
  let code = "";
  for (let i = 0; i < 8; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return `TC-${code}`;
}

/**
 * POST /api/beta/generate
 * Generates one or more invite codes. Admin only.
 *
 * Body: {
 *   count?: number,         // default 1, max 50
 *   email?: string,         // restrict to specific email
 *   grantedTier?: string,   // default 'pro'
 *   trialDays?: number,     // default 60
 *   expiresAt?: string,     // ISO date string, optional
 * }
 */
export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user || user.email !== ADMIN_EMAIL) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = await request.json();
    const count = Math.min(50, Math.max(1, body.count ?? 1));
    const grantedTier = body.grantedTier ?? "pro";
    const trialDays = body.trialDays ?? 60;
    const email = body.email ?? null;
    const expiresAt = body.expiresAt ?? null;

    const rows = Array.from({ length: count }, () => ({
      code: generateCode(),
      email,
      granted_tier: grantedTier,
      trial_days: trialDays,
      expires_at: expiresAt,
    }));

    const service = getServiceClient();
    const { data, error } = await service
      .from("beta_invites")
      .insert(rows)
      .select("code, granted_tier, trial_days, expires_at, email");

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ codes: data });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal error" },
      { status: 500 }
    );
  }
}

/**
 * GET /api/beta/generate
 * Lists all invite codes. Admin only.
 */
export async function GET() {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user || user.email !== ADMIN_EMAIL) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const service = getServiceClient();
    const { data, error } = await service
      .from("beta_invites")
      .select("*, redeemer:redeemed_by(id)")
      .order("created_at", { ascending: false });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ invites: data });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal error" },
      { status: 500 }
    );
  }
}
