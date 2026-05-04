"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { US_STATES, US_STATE_NAMES } from "@/lib/constants";
import { Check, AlertCircle, Loader2 } from "lucide-react";

// Admin-only edit form for an operator's city + state. Calls
// PATCH /api/admin/users/[userId]/location which canonicalizes the
// city before save and writes an admin_actions audit row.
//
// Surfaced because operators can finish signup but skip onboarding,
// leaving city NULL — which silently excludes them from marketplace
// matchmaking. Admin needs a way to nudge a city onto a profile
// without impersonating + walking through onboarding ourselves.

interface Props {
  userId: string;
  initialCity: string | null;
  initialState: string | null;
}

const CLEAR_STATE_VALUE = "__clear__";

export function LocationEditCard({ userId, initialCity, initialState }: Props) {
  const router = useRouter();
  const [city, setCity] = useState(initialCity ?? "");
  const [state, setState] = useState(initialState ?? "");
  const [saving, setSaving] = useState(false);
  const [, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [savedCity, setSavedCity] = useState<string | null>(null);

  const dirty =
    (city.trim() || "") !== (initialCity ?? "") ||
    (state || "") !== (initialState ?? "");

  async function handleSave() {
    setSaving(true);
    setError(null);
    setSavedCity(null);
    try {
      const res = await fetch(`/api/admin/users/${userId}/location`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ city, state }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error ?? `Save failed (HTTP ${res.status})`);
        setSaving(false);
        return;
      }
      // The server canonicalizes city — reflect the canonical form
      // back into the field so admin sees what was actually persisted.
      const savedCityValue: string = typeof body.city === "string" ? body.city : "";
      const savedStateValue: string = typeof body.state === "string" ? body.state : "";
      setCity(savedCityValue);
      setState(savedStateValue);
      setSavedCity(savedCityValue || "(cleared)");
      setSaving(false);
      // Refresh the parent server component so the header line
      // ("· St. Louis, MO") updates without a hard reload.
      startTransition(() => {
        router.refresh();
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error");
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Location</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-xs text-muted-foreground">
          City + state used by marketplace routing. City is normalized server-side (St. Louis / Saint Louis / St.Louis all collapse to the canonical form). Leaving either blank makes the operator un-routable on /request-event until they complete onboarding.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-[1fr_140px] gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="admin-edit-city" className="text-xs">
              City
            </Label>
            <Input
              id="admin-edit-city"
              value={city}
              onChange={(e) => setCity(e.target.value)}
              placeholder="Saint Louis"
              disabled={saving}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="admin-edit-state" className="text-xs">
              State
            </Label>
            <Select
              value={state || CLEAR_STATE_VALUE}
              onValueChange={(v) =>
                setState(!v || v === CLEAR_STATE_VALUE ? "" : v)
              }
              disabled={saving}
            >
              <SelectTrigger id="admin-edit-state">
                <SelectValue placeholder="—" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={CLEAR_STATE_VALUE}>—</SelectItem>
                {US_STATES.map((code) => (
                  <SelectItem key={code} value={code}>
                    {code} — {US_STATE_NAMES[code]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        {error && (
          <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
            <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
            <p>{error}</p>
          </div>
        )}
        {savedCity !== null && !error && (
          <div className="flex items-start gap-2 rounded-md border border-brand-teal/40 bg-brand-teal/5 p-3 text-sm">
            <Check className="h-4 w-4 mt-0.5 shrink-0 text-brand-teal" />
            <p>
              Saved as <span className="font-medium">{savedCity}</span>
              {state ? `, ${state}` : ""}.
            </p>
          </div>
        )}
        <div className="flex items-center justify-end">
          <Button onClick={handleSave} disabled={!dirty || saving} size="sm">
            {saving ? (
              <>
                <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                Saving…
              </>
            ) : (
              "Save location"
            )}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
