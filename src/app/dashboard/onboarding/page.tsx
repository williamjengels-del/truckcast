"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
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
import { CheckCircle, ArrowRight, TruckIcon } from "lucide-react";
import { US_STATES, US_TIMEZONES } from "@/lib/constants";

export default function OnboardingPage() {
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [profile, setProfile] = useState({
    business_name: "",
    city: "",
    state: "",
    timezone: "America/Chicago",
  });
  const router = useRouter();
  const supabase = createClient();

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
          onboarding_completed: step >= 3,
        })
        .eq("id", user.id);
    }

    setLoading(false);
    setStep(step + 1);
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

  return (
    <div className="max-w-2xl mx-auto">
      <div className="text-center mb-8">
        <TruckIcon className="h-12 w-12 text-primary mx-auto mb-4" />
        <h1 className="text-3xl font-bold">Welcome to TruckCast</h1>
        <p className="text-muted-foreground mt-2">
          Let&apos;s get your account set up in a few quick steps
        </p>
      </div>

      {/* Progress */}
      <div className="flex items-center justify-center gap-2 mb-8">
        {[1, 2, 3].map((s) => (
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
            {s < 3 && (
              <div
                className={`w-16 h-0.5 ${
                  s < step ? "bg-primary" : "bg-muted"
                }`}
              />
            )}
          </div>
        ))}
      </div>

      {/* Step 1: Business Profile */}
      {step === 1 && (
        <Card>
          <CardHeader>
            <CardTitle>Your Business</CardTitle>
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

      {/* Step 2: Import or Add Events */}
      {step === 2 && (
        <Card>
          <CardHeader>
            <CardTitle>Add Your Events</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-muted-foreground">
              The more historical data you add, the better your forecasts will
              be. You can always add more later.
            </p>
            <div className="grid gap-4">
              <Button
                variant="outline"
                className="h-20 text-left justify-start gap-4"
                onClick={() => router.push("/dashboard/events/import")}
              >
                <div>
                  <div className="font-semibold">Import CSV</div>
                  <div className="text-sm text-muted-foreground">
                    Upload historical events from a spreadsheet
                  </div>
                </div>
              </Button>
              <Button
                variant="outline"
                className="h-20 text-left justify-start gap-4"
                onClick={() => router.push("/dashboard/events")}
              >
                <div>
                  <div className="font-semibold">Add Events Manually</div>
                  <div className="text-sm text-muted-foreground">
                    Enter events one at a time
                  </div>
                </div>
              </Button>
            </div>
            <Button
              variant="ghost"
              className="w-full"
              onClick={() => setStep(3)}
            >
              Skip for now
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Step 3: Done */}
      {step === 3 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-center">You&apos;re all set!</CardTitle>
          </CardHeader>
          <CardContent className="text-center space-y-4">
            <CheckCircle className="h-16 w-16 text-green-500 mx-auto" />
            <p className="text-muted-foreground">
              Your TruckCast account is ready. Start adding events and the
              forecast engine will learn your business patterns over time.
            </p>
            <Button className="gap-2" onClick={handleComplete} disabled={loading}>
              Go to Dashboard <ArrowRight className="h-4 w-4" />
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
