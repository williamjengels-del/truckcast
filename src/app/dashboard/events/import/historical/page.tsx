"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  ArrowLeft,
  Calendar,
  CheckCircle,
  AlertCircle,
  Loader2,
  RefreshCw,
  Info,
} from "lucide-react";

type Provider = "square" | "clover";

interface PosConnection {
  provider: Provider;
  sync_enabled: boolean;
  last_synced_at: string | null;
}

interface SyncResult {
  success: boolean;
  provider: Provider;
  dateRange: { startDate: string; endDate: string };
  eventsUpdated: number;
  daysWithSales: number;
  ordersFound: number;
  error?: string;
}

const PROVIDER_LABELS: Record<Provider, string> = {
  square: "Square",
  clover: "Clover",
};

const PROVIDER_COLORS: Record<Provider, string> = {
  square: "bg-emerald-50 text-emerald-700 border-emerald-200",
  clover: "bg-green-50 text-green-700 border-green-200",
};

export default function HistoricalSalesImportPage() {
  const router = useRouter();
  const [connections, setConnections] = useState<PosConnection[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedProvider, setSelectedProvider] = useState<Provider | null>(null);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [syncing, setSyncing] = useState(false);
  const [result, setResult] = useState<SyncResult | null>(null);

  // Load connected providers on mount
  useEffect(() => {
    async function loadConnections() {
      const supabase = createClient();
      const { data } = await supabase
        .from("pos_connections")
        .select("provider, sync_enabled, last_synced_at")
        .in("provider", ["square", "clover"]);

      const validConnections = (data ?? []).filter(
        (c) => c.provider === "square" || c.provider === "clover"
      ) as PosConnection[];

      setConnections(validConnections);
      if (validConnections.length === 1) {
        setSelectedProvider(validConnections[0].provider);
      }
      setLoading(false);
    }
    loadConnections();
  }, []);

  // Default date range: 1 year ago to yesterday
  useEffect(() => {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const oneYearAgo = new Date();
    oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);

    setEndDate(yesterday.toISOString().slice(0, 10));
    setStartDate(oneYearAgo.toISOString().slice(0, 10));
  }, []);

  const dayCount =
    startDate && endDate
      ? Math.round(
          (new Date(endDate).getTime() - new Date(startDate).getTime()) /
            (1000 * 60 * 60 * 24)
        ) + 1
      : 0;

  async function handleSync() {
    if (!selectedProvider || !startDate || !endDate) return;

    setSyncing(true);
    setResult(null);

    try {
      const res = await fetch(`/api/pos/${selectedProvider}/sync`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ startDate, endDate }),
      });

      const data = await res.json();

      if (!res.ok) {
        setResult({
          success: false,
          provider: selectedProvider,
          dateRange: { startDate, endDate },
          eventsUpdated: 0,
          daysWithSales: 0,
          ordersFound: 0,
          error: data.error ?? "Sync failed. Please try again.",
        });
      } else {
        setResult({
          success: true,
          provider: selectedProvider,
          dateRange: { startDate, endDate },
          eventsUpdated: data.eventsUpdated ?? 0,
          daysWithSales: data.daysWithSales ?? 0,
          ordersFound: data.ordersFound ?? 0,
        });
      }
    } catch {
      setResult({
        success: false,
        provider: selectedProvider,
        dateRange: { startDate, endDate },
        eventsUpdated: 0,
        daysWithSales: 0,
        ordersFound: 0,
        error: "Network error. Check your connection and try again.",
      });
    } finally {
      setSyncing(false);
    }
  }

  const canSync =
    selectedProvider !== null &&
    startDate !== "" &&
    endDate !== "" &&
    startDate <= endDate &&
    !syncing;

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-8 space-y-6">
      {/* Header */}
      <div>
        <Link
          href="/dashboard/events"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-4"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Events
        </Link>
        <h1 className="text-2xl font-bold">Import Historical Sales</h1>
        <p className="text-muted-foreground mt-1">
          Pull past sales from your POS into TruckCast. The sync matches
          daily totals to events you already have booked on those dates.
        </p>
      </div>

      {/* How it works */}
      <Card className="border-blue-200 bg-blue-50/50">
        <CardContent className="pt-4 pb-4">
          <div className="flex gap-3">
            <Info className="h-4 w-4 text-blue-600 mt-0.5 shrink-0" />
            <div className="text-sm text-blue-800 space-y-1">
              <p className="font-medium">How this works</p>
              <ul className="list-disc list-inside space-y-0.5 text-blue-700">
                <li>Pick a date range and we&apos;ll pull all orders from your POS for those days</li>
                <li>Sales are matched to booked events by date — one event per day</li>
                <li>If you have multiple events on the same day, you&apos;ll be prompted to assign the total</li>
                <li>Invoice payments are automatically excluded so they don&apos;t skew your event sales</li>
              </ul>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* No connections state */}
      {connections.length === 0 && (
        <Card>
          <CardContent className="py-10 text-center space-y-3">
            <p className="text-muted-foreground">
              No POS integrations connected yet.
            </p>
            <Link
              href="/dashboard/settings/pos"
              className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium hover:bg-accent hover:text-accent-foreground transition-colors"
            >
              Connect a POS
            </Link>
          </CardContent>
        </Card>
      )}

      {/* Provider selection */}
      {connections.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Select POS Provider</CardTitle>
            <CardDescription>
              Only Square and Clover support historical date-range syncs.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex gap-3 flex-wrap">
              {connections.map((conn) => (
                <button
                  key={conn.provider}
                  onClick={() => setSelectedProvider(conn.provider)}
                  className={`flex items-center gap-2 px-4 py-2.5 rounded-lg border text-sm font-medium transition-all ${
                    selectedProvider === conn.provider
                      ? "border-primary bg-primary/5 text-primary ring-2 ring-primary/20"
                      : "border-border hover:border-primary/50 hover:bg-muted"
                  }`}
                >
                  <span>{PROVIDER_LABELS[conn.provider]}</span>
                  <Badge
                    variant="outline"
                    className={`text-xs ${PROVIDER_COLORS[conn.provider]}`}
                  >
                    Connected
                  </Badge>
                </button>
              ))}
            </div>
            {connections.length === 0 && (
              <p className="text-sm text-muted-foreground">
                No compatible POS providers connected.{" "}
                <Link href="/dashboard/settings/pos" className="text-primary hover:underline">
                  Connect one now →
                </Link>
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {/* Date range */}
      {connections.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Date Range</CardTitle>
            <CardDescription>
              We recommend starting with your earliest event date to capture your full history.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="start-date">Start date</Label>
                <Input
                  id="start-date"
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  max={endDate || undefined}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="end-date">End date</Label>
                <Input
                  id="end-date"
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  min={startDate || undefined}
                  max={new Date().toISOString().slice(0, 10)}
                />
              </div>
            </div>

            {dayCount > 0 && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Calendar className="h-4 w-4" />
                <span>{dayCount.toLocaleString()} day range selected</span>
                {dayCount > 365 && (
                  <span className="text-amber-600 font-medium">
                    — large ranges may take 30–60 seconds
                  </span>
                )}
              </div>
            )}

            {/* Quick presets */}
            <div className="flex flex-wrap gap-2">
              {[
                { label: "Last 30 days", days: 30 },
                { label: "Last 90 days", days: 90 },
                { label: "Last 6 months", days: 180 },
                { label: "Last year", days: 365 },
                { label: "Last 2 years", days: 730 },
              ].map(({ label, days }) => (
                <button
                  key={label}
                  onClick={() => {
                    const end = new Date();
                    end.setDate(end.getDate() - 1);
                    const start = new Date();
                    start.setDate(start.getDate() - days);
                    setStartDate(start.toISOString().slice(0, 10));
                    setEndDate(end.toISOString().slice(0, 10));
                  }}
                  className="text-xs px-2.5 py-1 rounded border hover:bg-muted transition-colors text-muted-foreground"
                >
                  {label}
                </button>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Action */}
      {connections.length > 0 && (
        <div className="flex items-center gap-3">
          <Button
            onClick={handleSync}
            disabled={!canSync}
            className="gap-2"
            size="lg"
          >
            {syncing ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Pulling sales…
              </>
            ) : (
              <>
                <RefreshCw className="h-4 w-4" />
                Pull Historical Sales
              </>
            )}
          </Button>
          {syncing && (
            <p className="text-sm text-muted-foreground">
              This can take up to a minute for large date ranges.
            </p>
          )}
        </div>
      )}

      {/* Result */}
      {result && (
        <Card
          className={
            result.success
              ? "border-emerald-200 bg-emerald-50/50"
              : "border-red-200 bg-red-50/50"
          }
        >
          <CardContent className="pt-5 pb-5">
            <div className="flex items-start gap-3">
              {result.success ? (
                <CheckCircle className="h-5 w-5 text-emerald-600 mt-0.5 shrink-0" />
              ) : (
                <AlertCircle className="h-5 w-5 text-red-600 mt-0.5 shrink-0" />
              )}
              <div className="space-y-2 flex-1">
                {result.success ? (
                  <>
                    <p className="font-semibold text-emerald-800">
                      Sync complete — {PROVIDER_LABELS[result.provider]}
                    </p>
                    <p className="text-sm text-emerald-700">
                      {result.dateRange.startDate} → {result.dateRange.endDate}
                    </p>
                    <div className="grid grid-cols-3 gap-3 mt-3">
                      <div className="bg-white rounded-lg border border-emerald-200 p-3 text-center">
                        <p className="text-2xl font-bold text-emerald-700">
                          {result.ordersFound.toLocaleString()}
                        </p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          Orders found
                        </p>
                      </div>
                      <div className="bg-white rounded-lg border border-emerald-200 p-3 text-center">
                        <p className="text-2xl font-bold text-emerald-700">
                          {result.daysWithSales}
                        </p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          Days with sales
                        </p>
                      </div>
                      <div className="bg-white rounded-lg border border-emerald-200 p-3 text-center">
                        <p className="text-2xl font-bold text-emerald-700">
                          {result.eventsUpdated}
                        </p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          Events updated
                        </p>
                      </div>
                    </div>
                    {result.eventsUpdated === 0 && result.daysWithSales > 0 && (
                      <p className="text-sm text-amber-700 mt-2">
                        Sales were found but no matching events were updated. Make
                        sure your events are booked in TruckCast for those dates.
                      </p>
                    )}
                    {result.eventsUpdated > 0 && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="mt-2"
                        onClick={() => router.push("/dashboard/events")}
                      >
                        View updated events →
                      </Button>
                    )}
                  </>
                ) : (
                  <>
                    <p className="font-semibold text-red-800">Sync failed</p>
                    <p className="text-sm text-red-700">{result.error}</p>
                    {result.error?.includes("connect") && (
                      <Link
                        href="/dashboard/settings/pos"
                        className="inline-flex items-center justify-center rounded-md border border-input bg-background px-3 py-1.5 text-xs font-medium hover:bg-accent transition-colors mt-1"
                      >
                        Reconnect {PROVIDER_LABELS[result.provider]}
                      </Link>
                    )}
                  </>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
