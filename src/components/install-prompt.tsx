"use client";

import { useEffect, useState } from "react";
import { X, Download, Share, Smartphone } from "lucide-react";
import { Button } from "@/components/ui/button";

// Android Chrome BeforeInstallPromptEvent — not in lib.dom, typed locally.
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

const SESSION_COUNT_KEY = "pwa_session_count";
const DISMISSED_KEY = "pwa_install_dismissed";
const SHOW_AFTER_SESSIONS = 2;

// ─── Platform detection ────────────────────────────────────────────────────

type Platform =
  | "hidden"
  | "android-native"   // Android + beforeinstallprompt captured → Install button
  | "ios-safari"       // iOS Safari → 4-step A2HS instructions
  | "ios-other"        // iOS non-Safari → redirect-to-Safari notice
  | "android-chrome"   // Android Chrome without the event → ⋮ menu steps
  | "android-other";   // Any other Android browser → generic menu instruction

function detectPlatform(deferredPromptAvailable: boolean): Platform {
  if (typeof window === "undefined") return "hidden";

  // Already installed — nothing to prompt.
  const standalone =
    window.matchMedia("(display-mode: standalone)").matches ||
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window.navigator as any).standalone === true;
  if (standalone) return "hidden";

  const ua = navigator.userAgent;
  const isMobile = /iPad|iPhone|iPod|Android/.test(ua);
  // Desktop users have the browser's own install UI (Chrome's address-bar
  // icon, Edge's install prompt). No banner needed.
  if (!isMobile) return "hidden";

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const isIOS = /iPad|iPhone|iPod/.test(ua) && !(window as any).MSStream;
  if (isIOS) {
    // iOS forces all browsers onto WebKit, but only real Safari can install.
    // Chrome/Firefox/Edge on iOS carry CriOS/FxiOS/EdgiOS/OPiOS tokens.
    const isIOSSafari = !/CriOS|FxiOS|EdgiOS|OPiOS/.test(ua);
    return isIOSSafari ? "ios-safari" : "ios-other";
  }

  // Android — prefer the native prompt when the browser gave us one.
  if (deferredPromptAvailable) return "android-native";

  const isAndroidChrome =
    /Chrome/.test(ua) &&
    !/SamsungBrowser/.test(ua) &&
    !/Firefox|FxiOS/.test(ua) &&
    !/EdgA/.test(ua) &&
    !/OPR/.test(ua);
  if (isAndroidChrome) return "android-chrome";

  // Samsung Internet, Firefox Android, etc. all land here.
  return "android-other";
}

// ─── Component ─────────────────────────────────────────────────────────────

/**
 * Floating bottom banner that prompts users to install VendCast, branched
 * per platform:
 *
 *   android-native  → Chrome's own install prompt (beforeinstallprompt)
 *   ios-safari      → 4-step Share → Add to Home Screen instructions
 *   ios-other       → text-only notice pointing user to Safari
 *   android-chrome  → manual ⋮ menu instructions (when native prompt absent)
 *   android-other   → generic browser-menu instruction
 *
 * Hidden entirely on desktop and when already running standalone. Shows
 * from the 2nd /dashboard visit onward. Dismissal is sticky per-device
 * via a single localStorage key — dismissed is dismissed.
 */
export function InstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] =
    useState<BeforeInstallPromptEvent | null>(null);
  const [platform, setPlatform] = useState<Platform>("hidden");

  useEffect(() => {
    if (localStorage.getItem(DISMISSED_KEY) === "1") return;

    const sessionCount = Number(localStorage.getItem(SESSION_COUNT_KEY) ?? "0") + 1;
    localStorage.setItem(SESSION_COUNT_KEY, String(sessionCount));
    if (sessionCount < SHOW_AFTER_SESSIONS) return;

    // Initial detection (before beforeinstallprompt has fired).
    setPlatform(detectPlatform(false));

    // Re-classify if the browser later fires beforeinstallprompt.
    const onBeforeInstall = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
      setPlatform(detectPlatform(true));
    };
    window.addEventListener("beforeinstallprompt", onBeforeInstall);

    // Hide the banner if the user installs while it's visible.
    const onInstalled = () => {
      setPlatform("hidden");
      setDeferredPrompt(null);
    };
    window.addEventListener("appinstalled", onInstalled);

    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstall);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  function dismiss() {
    localStorage.setItem(DISMISSED_KEY, "1");
    setPlatform("hidden");
  }

  async function handleAndroidNativeInstall() {
    if (!deferredPrompt) return;
    await deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    // Dismiss regardless of outcome — the appinstalled event fires on
    // success; on outright dismiss we respect the user's choice.
    dismiss();
    setDeferredPrompt(null);
  }

  if (platform === "hidden") return null;

  if (platform === "android-native") {
    return (
      <BannerShell icon={<Download className="h-5 w-5 text-primary" />} onDismiss={dismiss}>
        <p className="font-semibold text-sm">Install VendCast</p>
        <p className="text-xs text-muted-foreground mt-0.5">
          Add to your home screen for faster access and a full-screen experience.
        </p>
        <div className="flex gap-2 mt-3">
          <Button size="sm" onClick={handleAndroidNativeInstall} className="h-9">
            Install
          </Button>
          <Button size="sm" variant="ghost" onClick={dismiss} className="h-9 text-muted-foreground">
            Not now
          </Button>
        </div>
      </BannerShell>
    );
  }

  if (platform === "ios-safari") {
    return (
      <InstructionsShell
        title="Install VendCast on iPhone"
        icon={<Share className="h-4 w-4 text-primary" />}
        onDismiss={dismiss}
        steps={[
          <>Tap the <span className="font-medium">⋯</span> menu in Safari&apos;s address bar</>,
          <>Scroll down and tap <span className="font-medium">Share</span></>,
          <>Tap <span className="font-medium">Add to Home Screen</span></>,
          <>Tap <span className="font-medium">Add</span> to confirm</>,
        ]}
      />
    );
  }

  if (platform === "ios-other") {
    return (
      <BannerShell icon={<Share className="h-4 w-4 text-primary" />} onDismiss={dismiss}>
        <p className="font-semibold text-sm">Install VendCast on iPhone</p>
        <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
          iOS only allows installing web apps from Safari. Open{" "}
          <span className="font-mono">vendcast.co</span> in Safari to install.
        </p>
        <div className="mt-3">
          <Button size="sm" variant="ghost" onClick={dismiss} className="h-9 w-full">
            Got it
          </Button>
        </div>
      </BannerShell>
    );
  }

  if (platform === "android-chrome") {
    return (
      <InstructionsShell
        title="Install VendCast on Android"
        icon={<Download className="h-4 w-4 text-primary" />}
        onDismiss={dismiss}
        steps={[
          <>Tap the <span className="font-medium">⋮</span> menu in Chrome&apos;s address bar</>,
          <>Tap <span className="font-medium">Install app</span> (or &ldquo;Add to Home screen&rdquo;)</>,
          <>Tap <span className="font-medium">Install</span> to confirm</>,
        ]}
      />
    );
  }

  // android-other — generic fallback for Samsung Internet, Firefox, etc.
  return (
    <BannerShell
      icon={<Smartphone className="h-4 w-4 text-primary" />}
      onDismiss={dismiss}
    >
      <p className="font-semibold text-sm">Install VendCast on Android</p>
      <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
        Open your browser&apos;s menu (<span className="font-medium">⋮</span> or{" "}
        <span className="font-medium">☰</span>) and look for{" "}
        <span className="font-medium">Install app</span> or{" "}
        <span className="font-medium">Add to Home Screen</span>.
      </p>
      <div className="mt-3">
        <Button size="sm" variant="ghost" onClick={dismiss} className="h-9 w-full">
          Got it
        </Button>
      </div>
    </BannerShell>
  );
}

// ─── Layout shells ─────────────────────────────────────────────────────────

function BannerShell({
  children,
  icon,
  onDismiss,
}: {
  children: React.ReactNode;
  icon: React.ReactNode;
  onDismiss: () => void;
}) {
  return (
    <div
      role="dialog"
      aria-label="Install VendCast"
      className="fixed bottom-4 left-4 right-4 z-50 lg:left-auto lg:right-6 lg:max-w-sm rounded-xl border bg-card shadow-lg p-4"
    >
      <div className="flex items-start gap-3">
        <div className="mt-0.5 h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
          {icon}
        </div>
        <div className="flex-1 min-w-0">{children}</div>
        <button
          onClick={onDismiss}
          className="shrink-0 p-1 rounded hover:bg-muted text-muted-foreground"
          aria-label="Dismiss"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

function InstructionsShell({
  title,
  icon,
  steps,
  onDismiss,
}: {
  title: string;
  icon: React.ReactNode;
  steps: React.ReactNode[];
  onDismiss: () => void;
}) {
  return (
    <div
      role="dialog"
      aria-label={title}
      className="fixed bottom-4 left-4 right-4 z-50 rounded-xl border bg-card shadow-lg"
    >
      <div className="flex items-start justify-between gap-2 p-4 pb-2">
        <div className="flex items-center gap-2">
          <div className="h-9 w-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
            {icon}
          </div>
          <p className="font-semibold text-sm">{title}</p>
        </div>
        <button
          onClick={onDismiss}
          className="shrink-0 p-1.5 rounded hover:bg-muted text-muted-foreground -mt-0.5 -mr-1"
          aria-label="Dismiss"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <ol className="px-4 pb-3 space-y-2 text-sm">
        {steps.map((step, i) => (
          <li key={i} className="flex gap-3">
            <span className="shrink-0 h-5 w-5 rounded-full bg-muted text-[11px] font-bold flex items-center justify-center">
              {i + 1}
            </span>
            <span>{step}</span>
          </li>
        ))}
      </ol>
      <div className="px-4 pb-3 pt-1 border-t">
        <Button
          variant="ghost"
          size="sm"
          onClick={onDismiss}
          className="h-11 w-full text-sm"
        >
          Got it
        </Button>
      </div>
    </div>
  );
}
