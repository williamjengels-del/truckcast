import { createClient as createServiceClient } from "@supabase/supabase-js";
import { getAdminUser } from "@/lib/admin";
import { logAdminAction } from "@/lib/admin-audit";

// Admin-only feedback handlers.
//
// The user-facing POST (submit your own feedback) stays at /api/feedback.
// These two handlers cover the cross-user read + delete flow and live
// under /api/admin/* so they're exempt from the read-only impersonation
// mutation block together with the rest of the admin surface.

/**
 * GET /api/admin/feedback
 * Lists all feedback across all users. Admin only — feedback rows
 * contain other users' personal data.
 */
export async function GET() {
  try {
    if (!(await getAdminUser())) {
      return Response.json({ error: "Forbidden" }, { status: 403 });
    }

    const serviceClient = createServiceClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const { data, error } = await serviceClient
      .from("feedback")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) {
      console.error("Feedback fetch error:", error);
      return Response.json({ error: "Failed to fetch feedback" }, { status: 500 });
    }

    return Response.json({ feedback: data });
  } catch {
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}

/**
 * DELETE /api/admin/feedback
 * Body: { id }
 * Removes a feedback row. Admin only. Writes feedback.delete audit row.
 */
export async function DELETE(request: Request) {
  try {
    const admin = await getAdminUser();
    if (!admin) {
      return Response.json({ error: "Forbidden" }, { status: 403 });
    }

    const { id } = await request.json();
    if (!id) return Response.json({ error: "id required" }, { status: 400 });

    const serviceClient = createServiceClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const { error } = await serviceClient.from("feedback").delete().eq("id", id);
    if (error) return Response.json({ error: error.message }, { status: 500 });

    await logAdminAction(
      {
        adminUserId: admin.id,
        action: "feedback.delete",
        targetType: "feedback",
        targetId: id,
        metadata: null,
      },
      serviceClient
    );

    return Response.json({ success: true });
  } catch {
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
