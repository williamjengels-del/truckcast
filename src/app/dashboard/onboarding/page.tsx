"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { POSSetupGuide } from "@/components/pos-setup-guide";
import { DataImportGuide } from "@/components/data-import-guide";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  CheckCircle,
  ArrowRight,
  TruckIcon,
  FileSpreadsheet,
  PlusCircle,
  TrendingUp,
  BarChart3,
} from "lucide-react";
import { US_STATES, US_TIMEZONES } from "@/lib/constants";
import Link from "next/link";

export default function OnboardingPage() {
  const [step, setStep] = useState(1);
  const TOTAL_STEPS = 4;
  const [loading, setLoading] = useState(false);
  const [profile, setProfile] = useState({
    business_name: "",
    city: "",
    state: "",
    timezone: "America/Chicago",
  });
  const router = useRouter();
  const supabase = createClient();

  // Pre-populate form with any existing profile data (helps returning users who
  // were redirected back to onboarding before completing step 1)
  useEffect(() => {
    async function loadProfile() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data } = await supabase
        .from("profiles")
        .select("business_name, city, state, timezone")
        .eq("id", user.id)
        .single();
      if (data) {
        setProfile({
          business_name: data.business_name ?? "",
          city: data.city ?? "",
          state: data.state ?? "",
          timezone: data.timezone ?? "America/Chicago",
        });
      }
    }
    loadProfile();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleSaveProfile() {
    setLoading(true);
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (user) {
      await supabase
        .from("profiles")
        .update({
          ...profile,
          onboarding_completed: true,
        })
        .eq("id", user.id);
    }

    setLoading(false);
    setStep(2);
  }

  async function handleComplete() {
    setLoading(true);
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (user) {
      await supabase
        .from("profiles")
        .update({ onboarding_completed: true })
        .eq("id", user.id);
    }

    router.push("/dashboard");
    router.refresh();
  }

  async function handleSkipToStep3() {
    setLoading(true);
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (user) {
      await supabase
        .from("profiles")
        .update({ onboarding_completed: true })
        .eq("id", user.id);
    }

    setLoading(false);
    setStep(3); // POS setup step
  }

  return (
    <div className="max-w-2xl mx-auto">
      <div className="text-center mb-8">
        <TruckIcon className="h-12 w-12 text-primary mx-auto mb-4" />
        <h1 className="text-3xl font-bold">Welcome to TruckCast</h1>
        <p className="text-muted-foreground mt-2">
          Let&apos;s get your calendar set up in a few quick steps
        </p>
      </div>

      {/* Progress */}
      <div className="flex items-center justify-center gap-2 mb-8">
        {[1, 2, 3, 4].map((s) => (
          <div key={s} className="flex items-center gap-2">
            <div
              className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium ${
                s < step
                  ? "bg-primary text-primary-foreground"
                  : s === step
                    ? "bg-primary/20 text-primary border-2 border-primary"
                    : "bg-muted text-muted-foreground"
              }`}
            >
              {s < step ? <CheckCircle className="h-4 w-4" /> : s}
            </div>
            {s < 4 && (
              <div
                className={`w-16 h-0.5 ${
                  s < step ? "bg-primary" : "bg-muted"
                }`}
              />
            )}
          </div>
        ))}
      </div>

      {/* Step 1: Your Truck */}
      {step === 1 && (
        <Card>
          <CardHeader>
            <CardTitle>First, tell us about your truck</CardTitle>
            <p className="text-sm text-muted-foreground">
              This helps us tailor forecasts and weather data to your area
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="business_name">
                What&apos;s your food truck called?
              </Label>
              <Input
                id="business_name"
                value={profile.business_name}
                onChange={(e) =>
                  setProfile({ ...profile, business_name: e.target.value })
                }
                placeholder="e.g. Wok-O Taco"
                autoFocus
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="city">City</Label>
                <Input
                  id="city"
                  value={profile.city}
                  onChange={(e) =>
                    setProfile({ ...profile, city: e.target.value })
                  }
                  placeholder="St. Louis"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="state">State</Label>
                <Select
                  value={profile.state}
                  onValueChange={(val) =>
                    setProfile({ ...profile, state: val ?? "" })
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select state" />
                  </SelectTrigger>
                  <SelectContent>
                    {US_STATES.map((s) => (
                      <SelectItem key={s} value={s}>
                        {s}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="timezone">Timezone</Label>
              <Select
                value={profile.timezone}
                onValueChange={(val) =>
                  setProfile({ ...profile, timezone: val ?? "America/Chicago" })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {US_TIMEZONES.map((tz) => (
                    <SelectItem key={tz} value={tz}>
                      {tz.replace("America/", "").replace("_", " ")}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button
              className="w-full gap-2"
              onClick={handleSaveProfile}
              disabled={!profile.business_name || loading}
            >
              Continue <ArrowRight className="h-4 w-4" />
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Step 2: Get Your Schedule In */}
      {step === 2 && (
        <Card>
          <CardHeader>
            <CardTitle>Now let&apos;s get your events in</CardTitle>
            <p className="text-sm text-muted-foreground">
              The more events you add, the smarter your forecasts get. Even a
              few past events makes a big difference.
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            <DataImportGuide onComplete={() => setStep(3)} />

            {/* Skip — less prominent */}
            <div className="pt-2 text-center">
              <button
                type="button"
                onClick={handleSkipToStep3}
                disabled={loading}
                className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline disabled:opacity-50"
              >
                I&apos;ll do this later
              </button>
              <p className="mt-1.5 text-xs text-muted-foreground">
                You can always import later from the Events page.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Step 3: Connect your POS */}
      {step === 3 && (
        <Card>
          <CardHeader>
            <CardTitle>Automate your sales logging</CardTitle>
            <p className="text-sm text-muted-foreground">
              Pick your POS and we&apos;ll walk you through connecting it — so sales log themselves after every event.
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            <POSSetupGuide onComplete={() => setStep(4)} />
            <div className="pt-2 text-center">
              <button
                type="button"
                onClick={() => setStep(4)}
                className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
              >
                I&apos;ll set this up later
              </button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Step 4: You're ready! */}
      {step === 4 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-center">
              You&apos;re all set — here&apos;s what to do next
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Setup checklist */}
            <div className="space-y-3">
              {/* Business profile — always done */}
              <div className="flex items-start gap-3 rounded-lg border bg-muted/30 p-4">
                <CheckCircle className="mt-0.5 h-5 w-5 shrink-0 text-green-500" />
                <div>
                  <div className="font-medium">Business profile set up</div>
                  <div className="text-sm text-muted-foreground">
                    Your truck is registered in TruckCast
                  </div>
                </div>
              </div>

              {/* Add first event */}
              <div className="flex items-start gap-3 rounded-lg border p-4">
                <div className="mt-0.5 h-5 w-5 shrink-0 rounded-full border-2 border-muted-foreground/30" />
                <div className="flex-1">
                  <div className="font-medium">Add your first event</div>
                  <div className="text-sm text-muted-foreground">
                    Log a past or upcoming event to get started
                  </div>
                  <div className="mt-2 flex gap-2">
                    <Link href="/dashboard/events?new=true">
                      <Button size="sm" variant="outline" className="h-7 text-xs">
                        <PlusCircle className="mr-1.5 h-3.5 w-3.5" />
                        Add event
                      </Button>
                    </Link>
                    <Link href="/dashboard/events/import">
                      <Button size="sm" variant="outline" className="h-7 text-xs">
                        <FileSpreadsheet className="mr-1.5 h-3.5 w-3.5" />
                        Import CSV
                      </Button>
                    </Link>
                  </div>
                </div>
              </div>

              {/* Log sales */}
              <div className="flex items-start gap-3 rounded-lg border p-4">
                <div className="mt-0.5 h-5 w-5 shrink-0 rounded-full border-2 border-muted-foreground/30" />
                <div>
                  <div className="font-medium">Log sales after an event</div>
                  <div className="text-sm text-muted-foreground">
                    After each event, enter your actual sales so forecasts
                    improve over time
                  </div>
                </div>
              </div>

              {/* Check forecasts */}
              <div className="flex items-start gap-3 rounded-lg border p-4">
                <div className="mt-0.5 h-5 w-5 shrink-0 rounded-full border-2 border-muted-foreground/30" />
                <div className="flex-1">
                  <div className="font-medium">Check your forecasts</div>
                  <div className="text-sm text-muted-foreground">
                    See revenue predictions for upcoming events
                  </div>
                  <div className="mt-2">
                    <Link href="/dashboard/forecasts">
                      <Button size="sm" variant="outline" className="h-7 text-xs">
                        <BarChart3 className="mr-1.5 h-3.5 w-3.5" />
                        View forecasts
                      </Button>
                    </Link>
                  </div>
                </div>
              </div>
            </div>

            <div className="rounded-lg bg-primary/5 border border-primary/20 p-4 flex items-start gap-3">
              <TrendingUp className="mt-0.5 h-5 w-5 text-primary shrink-0" />
              <p className="text-sm text-muted-foreground">
                <span className="font-medium text-foreground">Pro tip:</span>{" "}
                Operators with 10+ past events see forecast accuracy improve
                significantly. Import your history when you get a chance.
              </p>
            </div>

            <Button
              className="w-full gap-2"
              onClick={handleComplete}
              disabled={loading}
            >
              Go to my dashboard <ArrowRight className="h-4 w-4" />
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
