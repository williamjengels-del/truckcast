import { createClient } from "@/lib/supabase/server";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import Link from "next/link";
import { TruckIcon } from "lucide-react";
import { MobileNav } from "@/components/mobile-nav";
import { TourButton } from "@/components/tour-button";

export async function Header() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  let profile = null;
  if (user) {
    const { data } = await supabase
      .from("profiles")
      .select("business_name, subscription_tier")
      .eq("id", user.id)
      .single();
    profile = data;
  }

  const initials =
    profile?.business_name
      ?.split(" ")
      .map((w: string) => w[0])
      .join("")
      .slice(0, 2)
      .toUpperCase() ?? "TC";

  // Tier pills — starter stays neutral, pro reads as brand presence
  // (teal), premium gets the differentiator/closer hue (orange) so it
  // visually signals "top tier" without leaning on a yellow palette.
  const tierColors: Record<string, string> = {
    starter: "bg-muted text-muted-foreground",
    pro: "bg-brand-teal/15 text-brand-teal",
    premium: "bg-brand-orange/15 text-brand-orange",
  };

  return (
    <header className="flex h-14 items-center justify-between border-b bg-card px-4 lg:px-6">
      <div className="flex items-center gap-2">
        <MobileNav />
        {/* Mobile-only brand mark so users know which app they're in.
            Desktop already has the full VendCast wordmark in the sidebar. */}
        <Link
          href="/dashboard"
          className="lg:hidden inline-flex items-center gap-1.5"
          aria-label="VendCast home"
        >
          <TruckIcon className="h-5 w-5 text-primary" />
          <span className="font-bold text-base tracking-tight">VendCast</span>
        </Link>
      </div>
      <div className="flex items-center gap-2">
        <TourButton />
        <Link
          href="/dashboard/settings"
          className="flex items-center gap-3 rounded-md px-2 py-1 transition-colors hover:bg-muted"
        >
          {profile && (
            <Badge
              variant="secondary"
              className={tierColors[profile.subscription_tier] ?? ""}
            >
              {profile.subscription_tier.charAt(0).toUpperCase() +
                profile.subscription_tier.slice(1)}
            </Badge>
          )}
          <Avatar className="h-8 w-8">
            <AvatarFallback className="text-xs">{initials}</AvatarFallback>
          </Avatar>
        </Link>
      </div>
    </header>
  );
}
