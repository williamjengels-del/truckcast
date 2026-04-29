"use client";

import { useEffect, useState, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Bell, BellOff, Lock, Smartphone } from "lucide-react";

type PermissionState = "default" | "granted" | "denied" | "unsupported";
type SubscribeState = "idle" | "subscribing" | "unsubscribing";

function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  // Allocate a dedicated ArrayBuffer (not SharedArrayBuffer) so the result
  // satisfies pushManager.subscribe()'s stricter BufferSource type.
  const buf = new ArrayBuffer(raw.length);
  const out = new Uint8Array(buf);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

function detectIOSNonStandalone(): boolean {
  if (typeof window === "undefined") return false;
  const ua = navigator.userAgent;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const isIOS = /iPad|iPhone|iPod/.test(ua) && !(window as any).MSStream;
  const isStandalone =
    window.matchMedia("(display-mode: standalone)").matches ||
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window.navigator as any).standalone === true;
  return isIOS && !isStandalone;
}

/**
 * Settings → Notifications card. Toggles a push subscription on this
 * device. Handles three browser states:
 *
 *   - unsupported: SW / PushManager missing. Render a static explanation.
 *   - denied: the user blocked notifications at the OS/browser level.
 *     Can't re-prompt; point them at browser settings.
 *   - default/granted: show the toggle. Flipping it calls subscribe() or
 *     unsubscribe() and syncs with /api/push/subscribe.
 *
 * iOS specifics: web push only works inside an installed PWA. If the user
 * is on iOS Safari (not standalone), render a note directing them to
 * install VendCast first. The subscribe call would return "denied" anyway
 * on non-standalone iOS, but the proactive message saves a confusing click.
 */
export function PushNotificationsCard() {
  const [permission, setPermission] = useState<PermissionState>("default");
  const [subscribed, setSubscribed] = useState<boolean>(false);
  const [state, setState] = useState<SubscribeState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [iosCaveat, setIosCaveat] = useState(false);
  const [ready, setReady] = useState(false);

  const refreshSubscription = useCallback(async () => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
      setPermission("unsupported");
      setReady(true);
      return;
    }
    setPermission(Notification.permission as PermissionState);
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      setSubscribed(!!sub);
    } catch {
      setSubscribed(false);
    }
    setReady(true);
  }, []);

  useEffect(() => {
    setIosCaveat(detectIOSNonStandalone());
    refreshSubscription();
  }, [refreshSubscription]);

  async function enable() {
    setError(null);
    setState("subscribing");
    try {
      const perm = await Notification.requestPermission();
      setPermission(perm as PermissionState);
      if (perm !== "granted") {
        setState("idle");
        setError(
          perm === "denied"
            ? "Notifications are blocked. Turn them on in your browser settings, then try again."
            : "Notification permission was not granted."
        );
        return;
      }

      const vapidKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
      if (!vapidKey) {
        setState("idle");
        setError("Push is not configured for this deploy.");
        return;
      }

      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidKey),
      });

      const json = sub.toJSON();
      const res = await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          endpoint: json.endpoint,
          keys: json.keys,
          userAgent: navigator.userAgent,
        }),
      });
      if (!res.ok) {
        // Roll back the browser subscription — we don't want orphan
        // subscriptions the server doesn't know about.
        await sub.unsubscribe();
        setState("idle");
        setError("Couldn't save subscription. Please try again.");
        return;
      }
      setSubscribed(true);
      setState("idle");
    } catch (err) {
      setState("idle");
      setError(err instanceof Error ? err.message : "Failed to enable notifications.");
    }
  }

  async function disable() {
    setError(null);
    setState("unsubscribing");
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await fetch(
          `/api/push/subscribe?endpoint=${encodeURIComponent(sub.endpoint)}`,
          { method: "DELETE" }
        );
        await sub.unsubscribe();
      }
      setSubscribed(false);
      setState("idle");
    } catch (err) {
      setState("idle");
      setError(err instanceof Error ? err.message : "Failed to disable notifications.");
    }
  }

  return (
    <Card className="max-w-2xl" id="push-notifications">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Bell className="h-5 w-5" />
          Push notifications
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {!ready && (
          <p className="text-sm text-muted-foreground">Loading…</p>
        )}

        {ready && permission === "unsupported" && (
          <p className="text-sm text-muted-foreground">
            This browser doesn&apos;t support web push notifications. Try Chrome on
            Android or Safari on iOS (after installing VendCast to your home screen).
          </p>
        )}

        {ready && permission !== "unsupported" && iosCaveat && (
          <div className="flex items-start gap-3 rounded-lg border bg-muted/40 p-3">
            <Smartphone className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
            <p className="text-xs text-muted-foreground">
              On iPhone, notifications only work after installing VendCast to your
              home screen. Tap the Mobile app section above to install, then come
              back here.
            </p>
          </div>
        )}

        {ready && permission === "denied" && (
          <div className="flex items-start gap-3 rounded-lg border border-muted bg-muted/40 p-3">
            <Lock className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
            <div className="text-xs text-muted-foreground">
              Notifications are <span className="font-medium">blocked</span> for this
              site. Turn them on in your browser settings, then reload this page to
              enable.
            </div>
          </div>
        )}

        {ready && (permission === "default" || permission === "granted") &&
          !iosCaveat && (
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-sm font-medium">
                  {subscribed ? "Enabled on this device" : "Enable push notifications on this device"}
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  Get notified instantly when a new booking inquiry lands, so you
                  don&apos;t lose time to DMs and email threads.
                </p>
              </div>
              <button
                type="button"
                disabled={state !== "idle"}
                onClick={subscribed ? disable : enable}
                className={`shrink-0 relative inline-flex h-7 w-12 items-center rounded-full transition-colors disabled:opacity-50 ${
                  subscribed ? "bg-primary" : "bg-muted"
                }`}
                aria-pressed={subscribed}
                aria-label={subscribed ? "Disable push notifications" : "Enable push notifications"}
              >
                <span
                  className={`inline-block h-5 w-5 transform rounded-full bg-white shadow-sm transition-transform ${
                    subscribed ? "translate-x-6" : "translate-x-1"
                  }`}
                />
                {state !== "idle" && (
                  <BellOff className="absolute right-1 h-3 w-3 text-muted-foreground animate-pulse" />
                )}
              </button>
            </div>
          )}

        {error && (
          <p className="text-xs text-destructive">{error}</p>
        )}
      </CardContent>
    </Card>
  );
}
