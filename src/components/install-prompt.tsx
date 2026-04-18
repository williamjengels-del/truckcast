"use client";

import { useEffect, useState } from "react";
import { X, Download, Share } from "lucide-react";
import { Button } from "@/components/ui/button";

// Android Chrome BeforeInstallPromptEvent — not in lib.dom, typed locally.
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

const SESSION_COUNT_KEY = "pwa_session_count";
const INSTALL_DISMISSED_KEY = "pwa_install_dismissed";
const IOS_HINT_DISMISSED_KEY = "pwa_ios_hint_dismissed";
const SHOW_AFTER_SESSIONS = 2;

function isIOS(): boolean {
  if (typeof window === "undefined") return false;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return /iPad|iPhone|iPod/.test(navigator.userAgent) && !(window as any).MSStream;
}

function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window.navigator as any).standalone === true
  );
}

/**
 * Floating bottom banner that prompts users to install VendCast.
 *  - Android Chrome fires `beforeinstallprompt`; we capture it and call
 *    `prompt()` when the user taps "Install".
 *  - iOS Safari can't trigger install programmatically. We detect iOS
 *    + non-standalone and show a small modal with Share → Add to Home
 *    Screen instructions instead.
 *  - Shows after SHOW_AFTER_SESSIONS visits to /dashboard. Dismissal is
 *    sticky in localStorage — no re-nagging.
 *  - Hidden entirely when already installed (display-mode: standalone).
 */
export function InstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] =
    useState<BeforeInstallPromptEvent | null>(null);
  const [showAndroid, setShowAndroid] = useState(false);
  const [showIOS, setShowIOS] = useState(false);

  useEffect(() => {
    if (isStandalone()) return; // Already installed — nothing to prompt.

    const sessionCount = Number(localStorage.getItem(SESSION_COUNT_KEY) ?? "0") + 1;
    localStorage.setItem(SESSION_COUNT_KEY, String(sessionCount));
    if (sessionCount < SHOW_AFTER_SESSIONS) return;

    // Android path — beforeinstallprompt tells us the browser considers
    // the site installable. Capture it so we can call prompt() later.
    const onBeforeInstall = (e: Event) => {
      e.preventDefault();
      if (localStorage.getItem(INSTALL_DISMISSED_KEY) === "1") return;
      setDeferredPrompt(e as BeforeInstallPromptEvent);
      setShowAndroid(true);
    };
    window.addEventListener("beforeinstallprompt", onBeforeInstall);

    // iOS path — the event above never fires on Safari. Feature-detect
    // iOS + non-standalone and show the A2HS hint modal.
    if (isIOS() && localStorage.getItem(IOS_HINT_DISMISSED_KEY) !== "1") {
      setShowIOS(true);
    }

    // Hide both prompts if the user later installs while this page is open.
    const onInstalled = () => {
      setShowAndroid(false);
      setShowIOS(false);
      setDeferredPrompt(null);
    };
    window.addEventListener("appinstalled", onInstalled);

    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstall);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  async function handleAndroidInstall() {
    if (!deferredPrompt) return;
    await deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    // Dismiss regardless of outcome — browser will fire `appinstalled`
    // on success; on dismiss, don't keep nagging.
    localStorage.setItem(INSTALL_DISMISSED_KEY, "1");
    setShowAndroid(false);
    setDeferredPrompt(null);
  }

  function handleAndroidDismiss() {
    localStorage.setItem(INSTALL_DISMISSED_KEY, "1");
    setShowAndroid(false);
  }

  function handleIOSDismiss() {
    localStorage.setItem(IOS_HINT_DISMISSED_KEY, "1");
    setShowIOS(false);
  }

  if (showAndroid) {
    return (
      <div
        role="dialog"
        aria-label="Install VendCast"
        className="fixed bottom-4 left-4 right-4 z-50 lg:left-auto lg:right-6 lg:max-w-sm rounded-xl border bg-card shadow-lg p-4"
      >
        <div className="flex items-start gap-3">
          <div className="mt-0.5 h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
            <Download className="h-5 w-5 text-primary" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-sm">Install VendCast</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Add to your home screen for faster access and a full-screen experience.
            </p>
            <div className="flex gap-2 mt-3">
              <Button size="sm" onClick={handleAndroidInstall} className="h-9">
                Install
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={handleAndroidDismiss}
                className="h-9 text-muted-foreground"
              >
                Not now
              </Button>
            </div>
          </div>
          <button
            onClick={handleAndroidDismiss}
            className="shrink-0 p-1 rounded hover:bg-muted text-muted-foreground"
            aria-label="Dismiss"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
    );
  }

  if (showIOS) {
    return (
      <div
        role="dialog"
        aria-label="Add VendCast to Home Screen"
        className="fixed bottom-4 left-4 right-4 z-50 rounded-xl border bg-card shadow-lg p-4"
      >
        <div className="flex items-start gap-3">
          <div className="mt-0.5 h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
            <Share className="h-5 w-5 text-primary" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-sm">Add VendCast to Home Screen</p>
            <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
              Tap <Share className="inline h-3 w-3 mx-0.5 -translate-y-px" /> Share,
              then <span className="font-medium">Add to Home Screen</span> for
              full-screen access + notifications.
            </p>
          </div>
          <button
            onClick={handleIOSDismiss}
            className="shrink-0 p-1 rounded hover:bg-muted text-muted-foreground"
            aria-label="Dismiss"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
    );
  }

  return null;
}
