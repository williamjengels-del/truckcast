import { NextRequest, NextResponse } from "next/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { getAdminUser } from "@/lib/admin";
import { logAdminAction } from "@/lib/admin-audit";

async function getAdminServiceClient() {
  if (!(await getAdminUser())) return null;
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const serviceClient = await getAdminServiceClient();
  if (!serviceClient) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const admin = await getAdminUser();
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const body = await request.json();

  // Whitelist allowed fields to prevent injection of arbitrary columns
  const allowed = ["author_name", "author_title", "content", "rating", "display_order", "is_active"] as const;
  type AllowedKey = typeof allowed[number];
  const update: Partial<Record<AllowedKey, unknown>> = {};
  for (const key of allowed) {
    if (key in body) update[key] = body[key];
  }

  // Validate types
  if (update.rating !== undefined && (typeof update.rating !== "number" || update.rating < 1 || update.rating > 5)) {
    return NextResponse.json({ error: "rating must be 1–5" }, { status: 400 });
  }
  if (update.author_name !== undefined && (typeof update.author_name !== "string" || (update.author_name as string).length > 200)) {
    return NextResponse.json({ error: "author_name too long" }, { status: 400 });
  }
  if (update.content !== undefined && (typeof update.content !== "string" || (update.content as string).length > 5000)) {
    return NextResponse.json({ error: "content too long" }, { status: 400 });
  }

  const { error } = await serviceClient
    .from("testimonials")
    .update(update)
    .eq("id", id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  await logAdminAction(
    {
      adminUserId: admin.id,
      action: "testimonial.update",
      targetType: "testimonial",
      targetId: id,
      metadata: { changes: Object.keys(update) },
    },
    serviceClient
  );

  return NextResponse.json({ success: true });
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const serviceClient = await getAdminServiceClient();
  if (!serviceClient) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const admin = await getAdminUser();
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;

  // Capture author name BEFORE delete — so the audit row can say
  // "deleted 'Jane Doe'" instead of a bare UUID.
  const { data: snapshot } = await serviceClient
    .from("testimonials")
    .select("author_name")
    .eq("id", id)
    .maybeSingle();

  const { error } = await serviceClient
    .from("testimonials")
    .delete()
    .eq("id", id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  await logAdminAction(
    {
      adminUserId: admin.id,
      action: "testimonial.delete",
      targetType: "testimonial",
      targetId: id,
      metadata: { author_name: snapshot?.author_name ?? null },
    },
    serviceClient
  );

  return NextResponse.json({ success: true });
}
