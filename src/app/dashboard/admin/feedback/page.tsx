import { createClient as createServiceClient } from "@supabase/supabase-js";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FeedbackTable } from "./feedback-client";

interface FeedbackRow {
  id: string;
  user_id: string | null;
  email: string | null;
  page: string | null;
  message: string;
  created_at: string;
}

export default async function AdminFeedbackPage() {
  // Auth handled by /dashboard/admin/layout.tsx
  const serviceClient = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const { data: feedback, error } = await serviceClient
    .from("feedback")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold">Feedback</h1>
        <p className="text-muted-foreground">
          Error loading feedback: {error.message}
        </p>
      </div>
    );
  }

  const rows = (feedback as FeedbackRow[]) || [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">User Feedback</h1>
        <p className="text-sm text-muted-foreground">
          {rows.length} feedback {rows.length === 1 ? "entry" : "entries"}
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>All Feedback</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <FeedbackTable initialRows={rows} />
        </CardContent>
      </Card>
    </div>
  );
}
