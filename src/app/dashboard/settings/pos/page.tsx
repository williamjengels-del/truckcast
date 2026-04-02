"use client";

import { Suspense, useState, useEffect, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { PosConnection, PosProvider, Profile } from "@/lib/database.types";

interface LocationSelection {
  id: string;
  selected: boolean;
}

export default function PosSettingsPage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center h-64 text-muted-foreground">
          Loading...
        </div>
      }
    >
      <PosSettingsContent />
    </Suspense>
  );
}

function PosSettingsContent() {
  const [connections, setConnections] = useState<PosConnection[]>([]);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState<PosProvider | null>(null);
  const [disconnecting, setDisconnecting] = useState<PosProvider | null>(null);
  const [locationSelections, setLocationSelections] = useState<
    Record<string, LocationSelection[]>
  >({});
  const searchParams = useSearchParams();
  const supabase = createClient();

  const success = searchParams.get("success");
  const error = searchParams.get("error");

  const loadData = useCallback(async () => {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;

    const [{ data: profileData }, { data: connectionsData }] =
      await Promise.all([
        supabase.from("profiles").select("*").eq("id", user.id).single(),
        supabase.from("pos_connections").select("*").eq("user_id", user.id),
      ]);

    setProfile(profileData as Profile | null);
    const conns = (connectionsData ?? []) as PosConnection[];
    setConnections(conns);

    // Build location selections map
    const selections: Record<string, LocationSelection[]> = {};
    for (const conn of conns) {
      selections[conn.provider] = conn.location_ids.map((id) => ({
        id,
        selected: conn.selected_location_ids.includes(id),
      }));
    }
    setLocationSelections(selections);

    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  function getConnection(provider: PosProvider): PosConnection | undefined {
    return connections.find((c) => c.provider === provider);
  }

  async function handleDisconnect(provider: PosProvider) {
    setDisconnecting(provider);
    const conn = getConnection(provider);
    if (!conn) return;

    await supabase.from("pos_connections").delete().eq("id", conn.id);
    await loadData();
    setDisconnecting(null);
  }

  async function handleSync(provider: PosProvider) {
    setSyncing(provider);
    try {
      const res = await fetch(`/api/pos/${provider}/sync`, {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok) {
        alert(data.error ?? "Sync failed");
      } else {
        alert(
          `Sync complete: ${data.ordersFound} orders found, ${data.eventsUpdated} events updated`
        );
      }
    } catch {
      alert("Sync request failed");
    }
    await loadData();
    setSyncing(null);
  }

  async function handleLocationToggle(
    provider: PosProvider,
    locationId: string
  ) {
    const conn = getConnection(provider);
    if (!conn) return;

    const current = locationSelections[provider] ?? [];
    const updated = current.map((loc) =>
      loc.id === locationId ? { ...loc, selected: !loc.selected } : loc
    );
    setLocationSelections((prev) => ({ ...prev, [provider]: updated }));

    const selectedIds = updated
      .filter((loc) => loc.selected)
      .map((loc) => loc.id);

    await supabase
      .from("pos_connections")
      .update({ selected_location_ids: selectedIds })
      .eq("id", conn.id);
  }

  const isPro =
    profile?.subscription_tier === "pro" ||
    profile?.subscription_tier === "premium";

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground">
        Loading...
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">POS Integrations</h1>
        <p className="text-muted-foreground">
          Connect your point-of-sale system to automatically import sales data
        </p>
      </div>

      {success && (
        <div className="rounded-md bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 p-4">
          <p className="text-sm text-green-800 dark:text-green-200">
            Successfully connected {success}! You can now sync your sales data.
          </p>
        </div>
      )}

      {error && (
        <div className="rounded-md bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 p-4">
          <p className="text-sm text-red-800 dark:text-red-200">
            Connection error: {decodeURIComponent(error)}
          </p>
        </div>
      )}

      {!isPro && (
        <div className="rounded-md bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 p-4">
          <p className="text-sm text-amber-800 dark:text-amber-200">
            POS integrations require a Pro or Premium subscription.{" "}
            <a
              href="/dashboard/settings"
              className="underline font-medium"
            >
              Upgrade your plan
            </a>
          </p>
        </div>
      )}

      {/* Square */}
      <PosProviderCard
        provider="square"
        label="Square"
        description="Connect your Square account to automatically pull order data."
        connection={getConnection("square")}
        locations={locationSelections["square"] ?? []}
        isPro={isPro}
        syncing={syncing === "square"}
        disconnecting={disconnecting === "square"}
        onConnect={() => {
          window.location.href = "/api/pos/square/authorize";
        }}
        onDisconnect={() => handleDisconnect("square")}
        onSync={() => handleSync("square")}
        onLocationToggle={(locationId) =>
          handleLocationToggle("square", locationId)
        }
      />

      {/* Clover */}
      <PosProviderCard
        provider="clover"
        label="Clover"
        description="Connect your Clover account to automatically pull order data."
        connection={getConnection("clover")}
        locations={locationSelections["clover"] ?? []}
        isPro={isPro}
        syncing={syncing === "clover"}
        disconnecting={disconnecting === "clover"}
        onConnect={() => {
          window.location.href = "/api/pos/clover/authorize";
        }}
        onDisconnect={() => handleDisconnect("clover")}
        onSync={() => handleSync("clover")}
        onLocationToggle={(locationId) =>
          handleLocationToggle("clover", locationId)
        }
      />
    </div>
  );
}

function PosProviderCard({
  label,
  description,
  connection,
  locations,
  isPro,
  syncing,
  disconnecting,
  onConnect,
  onDisconnect,
  onSync,
  onLocationToggle,
}: {
  provider: PosProvider;
  label: string;
  description: string;
  connection: PosConnection | undefined;
  locations: LocationSelection[];
  isPro: boolean;
  syncing: boolean;
  disconnecting: boolean;
  onConnect: () => void;
  onDisconnect: () => void;
  onSync: () => void;
  onLocationToggle: (locationId: string) => void;
}) {
  const isConnected = !!connection;

  return (
    <Card className="max-w-2xl">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <CardTitle>{label}</CardTitle>
            {isConnected ? (
              <Badge variant="default">Connected</Badge>
            ) : (
              <Badge variant="secondary">Not connected</Badge>
            )}
          </div>
          {isConnected && (
            <Button
              variant="destructive"
              size="sm"
              onClick={onDisconnect}
              disabled={disconnecting}
            >
              {disconnecting ? "Disconnecting..." : "Disconnect"}
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">{description}</p>

        {!isConnected && (
          <Button onClick={onConnect} disabled={!isPro}>
            {isPro ? `Connect ${label}` : "Requires Pro Plan"}
          </Button>
        )}

        {isConnected && (
          <>
            {/* Sync status */}
            <div className="rounded-md bg-muted p-3 space-y-1 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Merchant ID</span>
                <span className="font-mono">
                  {connection.merchant_id ?? "N/A"}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Last sync</span>
                <span>
                  {connection.last_sync_at
                    ? new Date(connection.last_sync_at).toLocaleString()
                    : "Never"}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Sync status</span>
                <span
                  className={
                    connection.last_sync_status === "success"
                      ? "text-green-600"
                      : connection.last_sync_status === "error"
                        ? "text-red-600"
                        : ""
                  }
                >
                  {connection.last_sync_status}
                </span>
              </div>
              {connection.last_sync_error && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Last error</span>
                  <span className="text-red-600 text-xs max-w-[300px] truncate">
                    {connection.last_sync_error}
                  </span>
                </div>
              )}
            </div>

            {/* Location selection */}
            {locations.length > 0 && (
              <div className="space-y-2">
                <p className="text-sm font-medium">Locations to sync</p>
                <div className="space-y-1">
                  {locations.map((loc) => (
                    <label
                      key={loc.id}
                      className="flex items-center gap-2 text-sm cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        checked={loc.selected}
                        onChange={() => onLocationToggle(loc.id)}
                        className="rounded"
                      />
                      <span className="font-mono text-xs">{loc.id}</span>
                    </label>
                  ))}
                </div>
              </div>
            )}

            {/* Sync button */}
            <div className="flex gap-2">
              <Button onClick={onSync} disabled={syncing}>
                {syncing ? "Syncing..." : "Sync Now"}
              </Button>
              <p className="text-xs text-muted-foreground self-center">
                Pulls yesterday&apos;s orders and matches to your booked events
              </p>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
