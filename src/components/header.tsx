import { createClient } from "@/lib/supabase/server";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import Link from "next/link";

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

  const tierColors: Record<string, string> = {
    starter: "bg-muted text-muted-foreground",
    pro: "bg-blue-100 text-blue-800",
    premium: "bg-amber-100 text-amber-800",
  };

  return (
    <header className="flex h-14 items-center justify-between border-b bg-card px-6">
      <div />
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
    </header>
  );
}
