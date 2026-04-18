import type { Metadata } from "next";
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

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Integrations</h1>
        <p className="text-muted-foreground text-sm">
          Connect your POS to auto-sync sales, or import historical events from CSV / Google Sheets.
        </p>
      </div>

      <IntegrationsTabBar activeTab={tab} />

      <div className="pt-2">
        {tab === "pos" && <PosTab />}
        {tab === "csv-import" && <CsvImportTab />}
      </div>
    </div>
  );
}
