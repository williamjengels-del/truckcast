import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { TruckIcon, CheckCircle2, XCircle } from "lucide-react";
import { verifyUnsubscribeToken } from "@/lib/unsubscribe-token";
import { UnsubscribeConfirmForm } from "./unsubscribe-confirm-form";

export const metadata: Metadata = {
  title: "Unsubscribe — VendCast",
  description:
    "Stop receiving VendCast marketing emails. Your account stays active.",
  // robots noindex — these URLs carry a per-user HMAC token that
  // shouldn't get crawled or cached publicly.
  robots: { index: false, follow: false },
};

// Server component — renders three states based on URL params:
//   1. Missing/invalid token → "this link isn't valid" with a path to
//      the logged-in preferences toggle.
//   2. Valid token, not yet confirmed → confirmation form (client child).
//      The two-step click-confirm pattern is intentional: many email
//      clients pre-fetch links (security scanners, link-preview cards),
//      and a GET-flips approach would silently opt operators out on
//      those pre-fetches.
//   3. ?done=1 — confirmation that the unsubscribe landed.
export default async function UnsubscribePage({
  searchParams,
}: {
  searchParams: Promise<{ u?: string; t?: string; done?: string }>;
}) {
  const params = await searchParams;
  const userId = params.u ?? "";
  const token = params.t ?? "";
  const done = params.done === "1";

  const tokenValid = verifyUnsubscribeToken(userId, token);

  return (
    <div className="min-h-screen bg-muted/30 flex items-center justify-center px-4 py-12">
      <div className="max-w-md w-full">
        <div className="text-center mb-6">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-muted mb-4">
            <TruckIcon className="h-7 w-7 text-muted-foreground" />
          </div>
          <h1 className="text-2xl font-bold text-foreground">Unsubscribe</h1>
        </div>

        {done ? (
          <div className="bg-card rounded-2xl shadow-sm border border-green-200 p-6 text-center">
            <CheckCircle2 className="h-12 w-12 text-green-500 mx-auto mb-3" />
            <h2 className="text-lg font-semibold text-foreground mb-2">
              You&apos;re unsubscribed
            </h2>
            <p className="text-sm text-muted-foreground">
              You won&apos;t receive marketing emails from VendCast anymore.
              Transactional emails (booking inquiries, security alerts,
              account notifications) will still arrive — those aren&apos;t
              affected by this preference.
            </p>
            <p className="mt-4 text-xs text-muted-foreground">
              Change your mind?{" "}
              <Link
                href="/dashboard/settings?tab=notifications"
                className="text-brand-teal underline"
              >
                Manage email preferences
              </Link>{" "}
              in your dashboard.
            </p>
          </div>
        ) : !tokenValid ? (
          <div className="bg-card rounded-2xl shadow-sm border border-border p-6 text-center">
            <XCircle className="h-12 w-12 text-muted-foreground mx-auto mb-3" />
            <h2 className="text-lg font-semibold text-foreground mb-2">
              This link isn&apos;t valid
            </h2>
            <p className="text-sm text-muted-foreground">
              The unsubscribe link is missing or expired. You can still
              opt out of marketing emails from your dashboard.
            </p>
            <Link
              href="/dashboard/settings?tab=notifications"
              className="mt-4 inline-block text-sm text-brand-teal underline"
            >
              Manage email preferences →
            </Link>
          </div>
        ) : (
          <div className="bg-card rounded-2xl shadow-sm border border-border p-6">
            <p className="text-sm text-muted-foreground mb-2">
              You&apos;re about to opt out of VendCast marketing emails:
            </p>
            <ul className="text-xs text-muted-foreground space-y-1 mb-4 list-disc pl-5">
              <li>Welcome + onboarding nudges</li>
              <li>Weekly digests</li>
              <li>Trial expiry reminders</li>
              <li>Sales-reminder follow-ups</li>
            </ul>
            <p className="text-xs text-muted-foreground mb-5">
              Transactional emails — booking inquiries, security alerts,
              account notifications — stay on. You can re-enable
              marketing at any time from{" "}
              <Link
                href="/dashboard/settings?tab=notifications"
                className="text-brand-teal underline"
              >
                your dashboard preferences
              </Link>
              .
            </p>
            <UnsubscribeConfirmForm userId={userId} token={token} />
          </div>
        )}

        <div className="mt-6 flex justify-center">
          <Link
            href="/"
            className="opacity-50 hover:opacity-80 transition-opacity"
            aria-label="VendCast home"
          >
            <Image
              src="/vendcast-logo.jpg"
              alt="VendCast"
              width={400}
              height={140}
              className="h-6 w-auto"
            />
          </Link>
        </div>
      </div>
    </div>
  );
}
