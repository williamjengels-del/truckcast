import { createClient as createServiceClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface FeedbackRow {
  id: string;
  user_id: string | null;
  email: string | null;
  page: string | null;
  message: string;
  created_at: string;
}

export default async function AdminFeedbackPage() {
  // Ensure user is authenticated
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

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

      {rows.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            No feedback yet.
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>All Feedback</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-48">Email</TableHead>
                  <TableHead className="w-40">Page</TableHead>
                  <TableHead>Message</TableHead>
                  <TableHead className="w-40">Date</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="text-sm">
                      {row.email || "Unknown"}
                    </TableCell>
                    <TableCell className="text-sm font-mono text-muted-foreground">
                      {row.page || "-"}
                    </TableCell>
                    <TableCell className="text-sm whitespace-pre-wrap">
                      {row.message}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {new Date(row.created_at).toLocaleDateString("en-US", {
                        month: "short",
                        day: "numeric",
                        year: "numeric",
                        hour: "numeric",
                        minute: "2-digit",
                      })}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
