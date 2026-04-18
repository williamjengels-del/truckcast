"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Smartphone, CheckCircle2 } from "lucide-react";

/**
 * Persistent install entry point on the Settings page. Pairs with the
 * dashboard-level InstallPrompt banner so users who dismissed the banner
 * or want to install later still have an obvious path.
 *
 *  - If already running standalone: shows "Installed" confirmation.
 *  - Otherwise: a "Show install instructions" button that clears both
 *    dismissal flags and reloads the dashboard so the banner/modal
 *    re-appears on next visit.
 */
export function InstallSettingsCard() {
  const [standalone, setStandalone] = useState<boolean | null>(null);

  useEffect(() => {
    const isStandalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window.navigator as any).standalone === true;
    setStandalone(isStandalone);
  }, []);

  function resetAndShow() {
    localStorage.removeItem("pwa_install_dismissed");
    localStorage.removeItem("pwa_ios_hint_dismissed");
    // Session count guard on the banner requires SHOW_AFTER_SESSIONS; the
    // user is already in a session right now, so just redirect to dashboard
    // where the banner mounts.
    window.location.href = "/dashboard";
  }

  // Don't render anything until we know the mode — avoids SSR/client mismatch
  // and the flash of the wrong state.
  if (standalone === null) {
    return (
      <Card className="max-w-2xl">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Smartphone className="h-5 w-5" />
            Mobile app
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">Loading…</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="max-w-2xl">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Smartphone className="h-5 w-5" />
          Mobile app
        </CardTitle>
      </CardHeader>
      <CardContent>
        {standalone ? (
          <div className="flex items-center gap-2 text-sm">
            <CheckCircle2 className="h-5 w-5 text-green-600" />
            <span className="font-medium">VendCast is installed on this device.</span>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Install VendCast on your phone for full-screen access and a home-screen icon.
              On iOS you&apos;ll need to install via Safari&apos;s{" "}
              <span className="font-medium">Share → Add to Home Screen</span> option.
            </p>
            <Button variant="outline" onClick={resetAndShow}>
              Show install instructions
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
