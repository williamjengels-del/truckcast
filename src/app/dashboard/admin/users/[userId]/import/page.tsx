import { notFound } from "next/navigation";
import Link from "next/link";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { ChevronLeft } from "lucide-react";
import { ImportEventsClient } from "./import-client";

// Auth handled by /dashboard/admin/layout.tsx.

interface PageProps {
  params: Promise<{ userId: string }>;
}

export default async function AdminImportEventsPage({ params }: PageProps) {
  const { userId } = await params;

  const service = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const { data: profile } = await service
    .from("profiles")
    .select("id, business_name, city, state")
    .eq("id", userId)
    .maybeSingle();

  if (!profile) notFound();

  const { data: authData } = await service.auth.admin.getUserById(userId);
  const email = authData?.user?.email ?? null;

  const targetLabel = profile.business_name ?? email ?? profile.id;

  return (
    <div className="space-y-6">
      <Link
        href={`/dashboard/admin/users/${userId}`}
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="h-4 w-4" />
        Back to {targetLabel}
      </Link>

      <div>
        <h1 className="text-2xl font-bold">Import events</h1>
        <p className="text-sm text-muted-foreground">
          Importing on behalf of <span className="font-medium">{targetLabel}</span>
          {email && profile.business_name ? ` (${email})` : ""}
        </p>
      </div>

      <ImportEventsClient userId={userId} targetLabel={targetLabel} />
    </div>
  );
}
