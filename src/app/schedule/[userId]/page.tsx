export const dynamic = "force-dynamic";
import type { Metadata } from "next";
import PublicScheduleView, {
  loadPublicSchedule,
} from "@/components/public-schedule-view";
import { createClient } from "@/lib/supabase/server";

interface Props {
  params: Promise<{ userId: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { userId } = await params;
  const supabase = await createClient();
  const { data } = await supabase
    .from("profiles")
    .select("business_name, public_slug")
    .eq("id", userId)
    .maybeSingle();
  const businessName = (data as { business_name?: string | null } | null)
    ?.business_name;
  const slug = (data as { public_slug?: string | null } | null)?.public_slug;

  const title = businessName
    ? `${businessName} — Schedule | VendCast`
    : "Schedule | VendCast";

  // When the operator has claimed a custom slug, that URL is the
  // canonical surface — search engines should index `/<slug>` rather
  // than the id-keyed URL.
  return slug
    ? { title, alternates: { canonical: `/${slug}` } }
    : { title };
}

export default async function PublicSchedulePage({ params }: Props) {
  const { userId } = await params;
  return <PublicScheduleView userId={userId} />;
}
