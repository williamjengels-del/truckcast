"use client";

import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Copy, Plus, RefreshCw } from "lucide-react";

interface Invite {
  id: string;
  code: string;
  email: string | null;
  granted_tier: string;
  trial_days: number;
  redeemed_by: string | null;
  redeemed_at: string | null;
  created_at: string;
  expires_at: string | null;
}

export function BetaClient() {
  const [invites, setInvites] = useState<Invite[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [count, setCount] = useState(1);
  const [email, setEmail] = useState("");
  const [tier, setTier] = useState("pro");
  const [trialDays, setTrialDays] = useState(60);
  const [copiedCode, setCopiedCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadInvites = useCallback(async () => {
    setLoading(true);
    const res = await fetch("/api/admin/beta/generate");
    if (res.ok) {
      const data = await res.json();
      setInvites(data.invites ?? []);
    } else {
      setError("Failed to load invite codes");
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadInvites();
  }, [loadInvites]);

  async function handleGenerate() {
    setGenerating(true);
    setError(null);
    const res = await fetch("/api/admin/beta/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        count,
        email: email.trim() || undefined,
        grantedTier: tier,
        trialDays,
      }),
    });
    const data = await res.json();
    setGenerating(false);

    if (!res.ok) {
      setError(data.error ?? "Failed to generate codes");
    } else {
      setEmail("");
      setCount(1);
      await loadInvites();
    }
  }

  async function copyCode(code: string) {
    await navigator.clipboard.writeText(code);
    setCopiedCode(code);
    setTimeout(() => setCopiedCode(null), 2000);
  }

  const redeemed = invites.filter((i) => i.redeemed_by);
  const unredeemed = invites.filter((i) => !i.redeemed_by);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Beta Invite Codes</h1>
        <p className="text-muted-foreground">
          Generate and manage invite codes for beta testers
        </p>
      </div>

      {error && (
        <div className="rounded-md bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 p-3 text-sm text-red-800 dark:text-red-200">
          {error}
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4">
        <Card>
          <CardContent className="pt-4">
            <p className="text-2xl font-bold">{invites.length}</p>
            <p className="text-sm text-muted-foreground">Total codes</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-2xl font-bold text-green-600">{redeemed.length}</p>
            <p className="text-sm text-muted-foreground">Redeemed</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-2xl font-bold">{unredeemed.length}</p>
            <p className="text-sm text-muted-foreground">Available</p>
          </CardContent>
        </Card>
      </div>

      {/* Generate form */}
      <Card className="max-w-lg">
        <CardHeader>
          <CardTitle>Generate Invite Codes</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <Label>Number of codes</Label>
              <Input
                type="number"
                onWheel={(e) => e.currentTarget.blur()}
                min={1}
                max={50}
                value={count}
                onChange={(e) => setCount(parseInt(e.target.value) || 1)}
              />
            </div>
            <div className="space-y-1">
              <Label>Trial days</Label>
              <Input
                type="number"
                onWheel={(e) => e.currentTarget.blur()}
                min={1}
                value={trialDays}
                onChange={(e) => setTrialDays(parseInt(e.target.value) || 60)}
              />
            </div>
          </div>
          <div className="space-y-1">
            <Label>Granted tier</Label>
            <select
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              value={tier}
              onChange={(e) => setTier(e.target.value)}
            >
              <option value="starter">Starter</option>
              <option value="pro">Pro</option>
              <option value="premium">Premium</option>
            </select>
          </div>
          <div className="space-y-1">
            <Label>
              Restrict to email{" "}
              <span className="text-xs text-muted-foreground font-normal">(optional)</span>
            </Label>
            <Input
              type="email"
              placeholder="tester@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <Button
            className="gap-2"
            onClick={handleGenerate}
            disabled={generating}
          >
            <Plus className="h-4 w-4" />
            {generating ? "Generating..." : `Generate ${count} Code${count !== 1 ? "s" : ""}`}
          </Button>
        </CardContent>
      </Card>

      {/* Invite codes list */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>All Codes</CardTitle>
            <Button variant="ghost" size="icon" onClick={loadInvites} disabled={loading}>
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {invites.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">
              No invite codes yet. Generate some above.
            </p>
          ) : (
            <div className="space-y-2">
              {invites.map((inv) => (
                <div
                  key={inv.id}
                  className={`flex items-center justify-between rounded-md border px-3 py-2 text-sm ${
                    inv.redeemed_by ? "opacity-60 bg-muted/50" : ""
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <span className="font-mono font-medium">{inv.code}</span>
                    <Badge variant={inv.redeemed_by ? "secondary" : "default"}>
                      {inv.redeemed_by ? "Redeemed" : inv.granted_tier}
                    </Badge>
                    {inv.email && (
                      <span className="text-xs text-muted-foreground">{inv.email}</span>
                    )}
                    {inv.redeemed_at && (
                      <span className="text-xs text-muted-foreground">
                        {new Date(inv.redeemed_at).toLocaleDateString()}
                      </span>
                    )}
                  </div>
                  {!inv.redeemed_by && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      onClick={() => copyCode(inv.code)}
                    >
                      <Copy className={`h-3.5 w-3.5 ${copiedCode === inv.code ? "text-green-600" : ""}`} />
                    </Button>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
