"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Trash2 } from "lucide-react";

export function ResetAccountButton() {
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  async function handleReset() {
    if (
      !confirm(
        "This will delete ALL your events, performance data, contacts, and booking requests, and reset onboarding. Your admin status and subscription tier are preserved.\n\nAre you sure?"
      )
    )
      return;

    setLoading(true);
    const res = await fetch("/api/admin/reset-account", { method: "POST" });
    const data = await res.json();

    if (data.success) {
      setDone(true);
      // Give them a moment to read the message then redirect to onboarding
      setTimeout(() => {
        window.location.href = "/dashboard/onboarding";
      }, 1500);
    } else {
      alert("Reset failed: " + (data.error ?? "Unknown error"));
      setLoading(false);
    }
  }

  if (done) {
    return (
      <p className="text-sm text-green-600 font-medium">
        ✓ Account wiped. Redirecting to onboarding...
      </p>
    );
  }

  return (
    <Button
      variant="destructive"
      size="sm"
      onClick={handleReset}
      disabled={loading}
    >
      <Trash2 className="h-4 w-4 mr-2" />
      {loading ? "Wiping..." : "Reset My Account Data"}
    </Button>
  );
}
