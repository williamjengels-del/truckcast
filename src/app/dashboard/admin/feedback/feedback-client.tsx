"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Trash2 } from "lucide-react";

interface FeedbackRow {
  id: string;
  user_id: string | null;
  email: string | null;
  page: string | null;
  message: string;
  created_at: string;
}

export function FeedbackTable({ initialRows }: { initialRows: FeedbackRow[] }) {
  const [rows, setRows] = useState(initialRows);
  const [deleting, setDeleting] = useState<string | null>(null);

  async function handleDelete(id: string) {
    if (!confirm("Delete this feedback entry?")) return;
    setDeleting(id);
    const res = await fetch("/api/admin/feedback", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    if (res.ok) {
      setRows((prev) => prev.filter((r) => r.id !== id));
    }
    setDeleting(null);
  }

  if (rows.length === 0) {
    return <p className="text-sm text-muted-foreground text-center py-8">No feedback yet.</p>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b bg-muted/50">
            <th className="text-left p-3 font-medium w-44">Email</th>
            <th className="text-left p-3 font-medium w-36">Page</th>
            <th className="text-left p-3 font-medium">Message</th>
            <th className="text-left p-3 font-medium w-36">Date</th>
            <th className="p-3 w-12"></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className="border-b last:border-0 hover:bg-muted/30">
              <td className="p-3 text-sm">{row.email || "Unknown"}</td>
              <td className="p-3 text-sm font-mono text-muted-foreground">{row.page || "—"}</td>
              <td className="p-3 text-sm whitespace-pre-wrap">{row.message}</td>
              <td className="p-3 text-sm text-muted-foreground">
                {new Date(row.created_at).toLocaleDateString("en-US", {
                  month: "short", day: "numeric", year: "numeric",
                  hour: "numeric", minute: "2-digit",
                })}
              </td>
              <td className="p-3">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 text-muted-foreground hover:text-destructive"
                  disabled={deleting === row.id}
                  onClick={() => handleDelete(row.id)}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
