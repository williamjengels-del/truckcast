import { createClient } from "@/lib/supabase/server";

/**
 * POST /api/feedback
 * User-facing: any authenticated user can submit feedback on their own
 * behalf. The row is inserted with their user_id and email attached.
 *
 * Admin-only handlers (GET all feedback, DELETE feedback row) live at
 * /api/admin/feedback to keep the /api/admin/* path convention honest
 * and to let the proxy mutation block (Commit 5b) exempt them from the
 * read-only-impersonation check along with all other admin routes.
 */
export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { message, page } = await request.json();

    if (!message || typeof message !== "string" || message.trim().length === 0) {
      return Response.json(
        { error: "Message is required" },
        { status: 400 }
      );
    }

    const { error } = await supabase.from("feedback").insert({
      user_id: user.id,
      email: user.email,
      page: page || null,
      message: message.trim(),
    });

    if (error) {
      console.error("Feedback insert error:", error);
      return Response.json(
        { error: "Failed to submit feedback" },
        { status: 500 }
      );
    }

    return Response.json({ success: true });
  } catch {
    return Response.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
