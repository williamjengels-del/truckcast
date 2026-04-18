import { createClient as createServiceClient } from "@supabase/supabase-js";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FeedbackTable } from "./feedback-client";
import { requireAdmin } from "@/lib/admin";

const adminNavItems = [
  { href: "/dashboard/admin", label: "Overview" },
  { href: "/dashboard/admin/users", label: "Users" },
  { href: "/dashboard/admin/data", label: "Event Data" },
  { href: "/dashboard/admin/beta", label: "Invites" },
  { href: "/dashboard/admin/feedback", label: "Feedback", active: true },
  { href: "/dashboard/admin/content", label: "Content" },
];

interface FeedbackRow {
  id: string;
  user_id: string | null;
  email: string | null;
  page: string | null;
  message: string;
  created_at: string;
}

export default async function AdminFeedbackPage() {
  await requireAdmin();

  // Use service role client to bypass RLS
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

      {/* Admin nav strip */}
      <div className="flex gap-1 border-b pb-0 -mb-2">
        {adminNavItems.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              item.active
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground hover:border-muted-foreground"
            }`}
          >
            {item.label}
          </Link>
        ))}
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
