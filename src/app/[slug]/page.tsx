export const dynamic = "force-dynamic";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import PublicScheduleView from "@/components/public-schedule-view";
import { createClient } from "@/lib/supabase/server";
import { isReservedSlug, validateSlug } from "@/lib/public-slug";

// Custom-vendor-profile resolver — Stage 3 of the public-slug workstream.
//
// Stage 1 landed `validateSlug()` + the DB column + unique index.
// Stage 2 landed the picker UI on /dashboard/settings.
// Stage 3 (this file) ships the public route: vendcast.co/<slug>.
//
// The route is a top-level catch-all. Static segments (/pricing,
// /dashboard, /follow, etc.) take precedence in Next's routing tree, so
// this page only executes for URLs that don't match any other route.
// `RESERVED_SLUGS` in `@/lib/public-slug` is the source of truth for
// which slugs are off-limits at write time; we re-check at the route
// layer as defense in depth.

interface Props {
  params: Promise<{ slug: string }>;
}

interface ProfileLookup {
  id: string;
  business_name: string | null;
  public_slug: string | null;
}

async function resolveSlug(rawSlug: string): Promise<ProfileLookup | null> {
  // Validate before hitting the DB. URL slugs that don't match the
  // pattern can't possibly be in the unique index, so we save a query
  // and fall through to notFound() faster.
  const validation = validateSlug(rawSlug);
  if (!validation.ok) return null;
  if (isReservedSlug(validation.slug)) return null;

  const supabase = await createClient();
  const { data } = await supabase
    .from("profiles")
    .select("id, business_name, public_slug")
    .eq("public_slug", validation.slug)
    .maybeSingle();

  return (data as ProfileLookup | null) ?? null;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const profile = await resolveSlug(slug);
  if (!profile) {
    return { title: "Not found | VendCast" };
  }
  const title = profile.business_name
    ? `${profile.business_name} — Schedule | VendCast`
    : "Schedule | VendCast";
  return {
    title,
    alternates: { canonical: `/${slug}` },
  };
}

export default async function PublicSlugPage({ params }: Props) {
  const { slug } = await params;
  const profile = await resolveSlug(slug);
  if (!profile) notFound();
  return <PublicScheduleView userId={profile.id} />;
}
