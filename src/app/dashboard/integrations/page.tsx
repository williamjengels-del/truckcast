import type { Metadata } from "next";
import Link from "next/link";
import { resolveScopedSupabase } from "@/lib/dashboard-scope";
import { isTrialHardGateExpired } from "@/lib/supabase/middleware";
import { IntegrationsTabBar } from "./integrations-tab-bar";
import { PosTab } from "./pos-tab";
import { CsvImportTab } from "./csv-import-tab";

type IntegrationsTabKey = "pos" | "csv-import";

function normalizeTab(raw: string | string[] | undefined): IntegrationsTabKey {
  const v = Array.isArray(raw) ? raw[0] : raw;
  if (v === "csv-import") return "csv-import";
  return "pos"; // default
}

interface IntegrationsPageProps {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

export async function generateMetadata({ searchParams }: IntegrationsPageProps): Promise<Metadata> {
  const params = await searchParams;
  const tab = normalizeTab(params.tab);
  const title = tab === "pos" ? "POS Integrations" : "CSV Import";
  return { title: `Integrations — ${title}` };
}

export default async function IntegrationsPage({ searchParams }: IntegrationsPageProps) {
  const params = await searchParams;
  const tab = normalizeTab(params.tab);

  // Trial-expired banner — om-11 fix. /dashboard/integrations is now
  // in TRIAL_GATE_EXEMPT so operators can finish a CSV import they
  // started before the trial ended. Without this banner they'd see
  // the import succeed and then bounce off /dashboard/events.
  let showTrialExpiredBanner = false;
  const scope = await resolveScopedSupabase();
  if (scope.kind === "normal") {
    const { data: profile } = await scope.client
      .from("profiles")
      .select("created_at, stripe_subscription_id, trial_extended_until, owner_user_id")
      .eq("id", scope.userId)
      .maybeSingle();
    showTrialExpiredBanner = isTrialHardGateExpired(profile as {
      created_at: string | null;
      stripe_subscription_id: string | null;
      trial_extended_until: string | null;
      owner_user_id: string | null;
    } | null);
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Integrations</h1>
        <p className="text-muted-foreground text-sm">
          Connect your POS to auto-sync sales, or import historical events from CSV / Google Sheets.
        </p>
      </div>

      {showTrialExpiredBanner && (
        <div className="rounded-md border border-brand-orange/40 bg-brand-orange/5 p-4 text-sm space-y-2">
          <p className="font-medium">Your trial has ended.</p>
          <p className="text-muted-foreground">
            You can finish importing the data you started, but you&apos;ll need
            to subscribe to see your events and forecasts. Imported rows stay
            in your account and unlock the moment you upgrade.
          </p>
          <Link
            href="/dashboard/upgrade"
            className="inline-block mt-1 px-3 py-1.5 rounded-md bg-brand-orange text-white text-sm font-medium hover:bg-brand-orange/90 transition-colors"
          >
            Upgrade to continue →
          </Link>
        </div>
      )}

      <IntegrationsTabBar activeTab={tab} />

      <div className="pt-2">
        {tab === "pos" && <PosTab />}
        {tab === "csv-import" && <CsvImportTab />}
      </div>
    </div>
  );
}
