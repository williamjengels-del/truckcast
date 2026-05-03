import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { FindVendorLink } from "@/components/find-vendor-link";
import { CheckCircle2, AlertCircle, XCircle, HelpCircle } from "lucide-react";

export const metadata: Metadata = {
  title: "Status — VendCast",
  description: "Real-time operational status for VendCast subsystems — dashboard, database, billing, weather, email, and chatbot.",
};

// Forces fresh fetch on every page load so the displayed status reflects
// real subsystem state, not a stale cache. The /api/status route itself
// is edge-cached at 60s, so even a flood of /status visits won't flood
// the underlying services.
export const dynamic = "force-dynamic";
export const revalidate = 0;

interface SubsystemStatus {
  name: string;
  status: "operational" | "degraded" | "down" | "unknown";
  detail?: string;
}

interface StatusPayload {
  overall: SubsystemStatus["status"];
  checked_at: string;
  subsystems: SubsystemStatus[];
}

async function fetchStatus(): Promise<StatusPayload | null> {
  try {
    // Server-side fetch against our own /api/status. We construct an
    // absolute URL because Next.js server components don't have a
    // baseURL — VERCEL_URL is set on Vercel deployments, fall back to
    // localhost for `npm run dev`.
    const base = process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
    const res = await fetch(`${base}/api/status`, { cache: "no-store" });
    if (!res.ok) return null;
    return (await res.json()) as StatusPayload;
  } catch {
    return null;
  }
}

const STATUS_DISPLAY: Record<
  SubsystemStatus["status"],
  { label: string; className: string; Icon: typeof CheckCircle2 }
> = {
  operational: {
    label: "Operational",
    className: "text-green-700 dark:text-green-400",
    Icon: CheckCircle2,
  },
  degraded: {
    label: "Degraded",
    className: "text-warning",
    Icon: AlertCircle,
  },
  down: {
    label: "Down",
    className: "text-destructive",
    Icon: XCircle,
  },
  unknown: {
    label: "Unknown",
    className: "text-muted-foreground",
    Icon: HelpCircle,
  },
};

const OVERALL_BANNER: Record<
  SubsystemStatus["status"],
  { headline: string; sub: string; className: string }
> = {
  operational: {
    headline: "All systems operational",
    sub: "Everything's running normally. If you're seeing an issue, send feedback.",
    className: "border-green-500/30 bg-green-50/50 dark:bg-green-950/10",
  },
  degraded: {
    headline: "Some systems degraded",
    sub: "One or more subsystems are reachable but not at full capacity. Most flows still work.",
    className: "border-warning/40 bg-warning/5",
  },
  down: {
    headline: "Service disruption",
    sub: "One or more subsystems are unreachable. We're investigating.",
    className: "border-destructive/40 bg-destructive/5",
  },
  unknown: {
    headline: "Status unavailable",
    sub: "Couldn't reach the status endpoint. The dashboard itself may still be working — try logging in.",
    className: "border-muted bg-muted/30",
  },
};

export default async function StatusPage() {
  const data = await fetchStatus();
  const overall = data?.overall ?? "unknown";
  const banner = OVERALL_BANNER[overall];
  const checkedAt = data?.checked_at
    ? new Date(data.checked_at).toLocaleString("en-US", {
        dateStyle: "medium",
        timeStyle: "short",
      })
    : "—";

  return (
    <div className="min-h-screen flex flex-col">
      {/* Top nav (mirrors homepage) */}
      <header className="border-b">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2">
            <Image
              src="/vendcast-logo.jpg"
              alt="VendCast"
              width={120}
              height={32}
              className="h-8 w-auto"
              priority
            />
          </Link>
          <nav className="flex items-center gap-2">
            <Link href="/changelog" className="text-sm hover:text-brand-teal hidden sm:inline-block px-3 py-2">
              Changelog
            </Link>
            <Link href="/help" className="text-sm hover:text-brand-teal hidden sm:inline-block px-3 py-2">
              Help
            </Link>
            <FindVendorLink />
            <Link href="/login">
              <Button variant="ghost" size="sm">Log in</Button>
            </Link>
          </nav>
        </div>
      </header>

      <main className="flex-1">
        <div className="container mx-auto px-4 py-16 max-w-3xl">
          <div className="mb-8 text-center">
            <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-3">
              VendCast Status
            </p>
            <h1 className="text-3xl sm:text-4xl font-bold tracking-tight">
              Service status
            </h1>
          </div>

          {/* Overall banner */}
          <div className={`rounded-2xl border p-6 md:p-8 mb-8 text-center ${banner.className}`}>
            <h2 className="text-xl font-bold">{banner.headline}</h2>
            <p className="text-sm text-muted-foreground mt-2">{banner.sub}</p>
            <p className="text-xs text-muted-foreground mt-4">Last checked: {checkedAt}</p>
          </div>

          {/* Per-subsystem table */}
          <div className="rounded-xl border divide-y">
            {(data?.subsystems ?? []).map((sub) => {
              const display = STATUS_DISPLAY[sub.status];
              return (
                <div
                  key={sub.name}
                  className="flex items-center justify-between gap-4 px-5 py-4"
                >
                  <div className="flex items-center gap-3">
                    <display.Icon className={`h-5 w-5 ${display.className}`} />
                    <div>
                      <p className="font-medium">{sub.name}</p>
                      {sub.detail && (
                        <p className="text-xs text-muted-foreground">{sub.detail}</p>
                      )}
                    </div>
                  </div>
                  <p className={`text-sm font-medium ${display.className}`}>
                    {display.label}
                  </p>
                </div>
              );
            })}
            {!data && (
              <div className="px-5 py-8 text-center text-sm text-muted-foreground">
                Couldn&apos;t reach the status endpoint. The dashboard itself may still be operational — try{" "}
                <Link href="/login" className="text-brand-teal hover:underline">
                  logging in
                </Link>
                .
              </div>
            )}
          </div>

          <div className="mt-12 text-center text-sm text-muted-foreground">
            <p>
              Status checks ping each subsystem live. &ldquo;Operational&rdquo; means the dependency is reachable + configured.
              For more detail or to report something we missed,{" "}
              <Link href="/contact" className="text-brand-teal hover:underline">
                send feedback
              </Link>
              .
            </p>
          </div>
        </div>
      </main>

      <footer className="border-t py-8">
        <div className="container mx-auto px-4 text-center text-sm text-muted-foreground">
          <Link href="/" className="hover:text-brand-teal">VendCast</Link>
          {" · "}
          <Link href="/pricing" className="hover:text-brand-teal">Pricing</Link>
          {" · "}
          <Link href="/changelog" className="hover:text-brand-teal">Changelog</Link>
          {" · "}
          <Link href="/help" className="hover:text-brand-teal">Help</Link>
        </div>
      </footer>
    </div>
  );
}
