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

  // Canonical URL resolution: prefer the slug-keyed URL when claimed,
  // fall back to the id-keyed self-URL. Pre-fix (production audit
  // 2026-05-10): when no slug existed, the page emitted no
  // canonical/og:url override, so the root layout's default
  // `canonical: "https://vendcast.co"` leaked through — every
  // social-share preview rendered as generic "VendCast" instead of
  // the operator's business name. Also missing OG metadata entirely.
  const path = slug ? `/${slug}` : `/schedule/${userId}`;
  const description = businessName
    ? `Upcoming events for ${businessName}. See where they're booked, what events they're attending, and how to get in touch.`
    : "Upcoming food-truck schedule on VendCast.";

  return {
    title,
    description,
    alternates: { canonical: path },
    openGraph: {
      title,
      description,
      url: path,
      type: "website",
      siteName: "VendCast",
    },
    twitter: {
      card: "summary",
      title,
      description,
    },
  };
}

export default async function PublicSchedulePage({ params }: Props) {
  const { userId } = await params;
  return <PublicScheduleView userId={userId} />;
}
