import type { Metadata } from "next";
import Link from "next/link";
import { TruckIcon } from "lucide-react";

export const metadata: Metadata = {
  title: "Privacy Policy — TruckCast by VendCast",
  description: "How VendCast / TruckCast collects, uses, and protects your data.",
};

export default function PrivacyPage() {
  return (
    <div className="flex flex-col min-h-screen">
      <header className="border-b">
        <div className="container mx-auto flex h-16 items-center justify-between px-4">
          <Link href="/" className="flex items-center gap-2">
            <TruckIcon className="h-7 w-7 text-primary" />
            <span className="text-xl font-bold">TruckCast</span>
          </Link>
        </div>
      </header>

      <main className="flex-1">
        <div className="container mx-auto px-4 py-12 max-w-3xl prose prose-neutral dark:prose-invert">
          <h1 className="text-3xl font-bold mb-2">Privacy Policy</h1>
          <p className="text-muted-foreground text-sm mb-8">Last updated: April 3, 2026</p>

          <div className="space-y-8 text-sm leading-relaxed">

            <section>
              <h2 className="text-lg font-semibold mb-3">1. Who we are</h2>
              <p className="text-muted-foreground">
                TruckCast is a software-as-a-service product built and operated by Julian Engels
                (&ldquo;we,&rdquo; &ldquo;us,&rdquo; or &ldquo;our&rdquo;). TruckCast helps food truck
                operators forecast event revenue, track performance, and optimize booking decisions.
                Questions about this policy can be directed to{" "}
                <a href="mailto:support@truckcast.app" className="text-primary hover:underline">
                  support@truckcast.app
                </a>.
              </p>
            </section>

            <section>
              <h2 className="text-lg font-semibold mb-3">2. What data we collect</h2>
              <p className="text-muted-foreground mb-3">When you use TruckCast, we collect:</p>
              <ul className="list-disc list-inside space-y-2 text-muted-foreground">
                <li><strong className="text-foreground">Account information:</strong> your email address, business name, city, and state.</li>
                <li><strong className="text-foreground">Event data:</strong> event names, dates, locations, sales figures, fee structures, event types, weather conditions, attendance estimates, and any notes you enter.</li>
                <li><strong className="text-foreground">POS data:</strong> sales totals imported from connected point-of-sale systems (Square, Clover, Toast). OAuth tokens are stored encrypted and never exposed.</li>
                <li><strong className="text-foreground">Usage data:</strong> pages visited, features used, and general interaction patterns within the app.</li>
                <li><strong className="text-foreground">Payment data:</strong> billing and subscription information processed by Stripe. TruckCast does not store full payment card details.</li>
              </ul>
            </section>

            <section>
              <h2 className="text-lg font-semibold mb-3">3. How we use your data</h2>
              <p className="text-muted-foreground mb-3">We use your data to:</p>
              <ul className="list-disc list-inside space-y-2 text-muted-foreground">
                <li>Provide the TruckCast service — forecasting, performance tracking, and analytics.</li>
                <li>Maintain and improve the application.</li>
                <li>Process payments and manage your subscription.</li>
                <li>Send transactional emails (account confirmation, billing receipts).</li>
              </ul>
            </section>

            <section className="rounded-lg border border-primary/30 bg-primary/5 p-5">
              <h2 className="text-lg font-semibold mb-3">4. Internal model improvement — how we use your event data</h2>
              <p className="text-muted-foreground mb-3">
                TruckCast&apos;s forecast engine improves over time as more event data accumulates.
                By default, your event data (including event names, dates, types, locations, sales
                figures, weather conditions, and fee structures) may be accessed by TruckCast
                internally to analyze patterns, validate forecast accuracy, and improve the
                forecasting model for all users.
              </p>
              <p className="text-muted-foreground mb-3">
                <strong className="text-foreground">This data is never sold, shared with third parties, or made accessible to other TruckCast users.</strong>{" "}
                It is used exclusively by TruckCast&apos;s operator (Julian Engels) for internal
                product development and model refinement.
              </p>
              <p className="text-muted-foreground">
                If you prefer that your event data not be used for model improvement, you can
                opt out at any time in{" "}
                <Link href="/dashboard/settings" className="text-primary hover:underline">
                  Dashboard → Settings → Data &amp; Privacy
                </Link>
                . Opting out does not affect the core functionality of TruckCast for your account.
              </p>
            </section>

            <section>
              <h2 className="text-lg font-semibold mb-3">5. Data isolation and security</h2>
              <p className="text-muted-foreground">
                All user data is stored in a Supabase PostgreSQL database with Row Level Security
                enforced at the database level. No TruckCast user can view another user&apos;s events,
                sales, contacts, or forecasts through the application. POS OAuth credentials are
                stored encrypted in Supabase Vault and are never transmitted to the client.
              </p>
            </section>

            <section>
              <h2 className="text-lg font-semibold mb-3">6. Third-party services</h2>
              <p className="text-muted-foreground mb-3">TruckCast uses the following third-party services:</p>
              <ul className="list-disc list-inside space-y-2 text-muted-foreground">
                <li><strong className="text-foreground">Supabase</strong> — database and authentication hosting.</li>
                <li><strong className="text-foreground">Vercel</strong> — application hosting and deployment.</li>
                <li><strong className="text-foreground">Stripe</strong> — payment processing and subscription management.</li>
                <li><strong className="text-foreground">Open-Meteo</strong> — weather forecast data (no personal data shared).</li>
              </ul>
              <p className="text-muted-foreground mt-3">
                Each of these services has their own privacy policy governing their data practices.
              </p>
            </section>

            <section>
              <h2 className="text-lg font-semibold mb-3">7. Data retention</h2>
              <p className="text-muted-foreground">
                We retain your data for as long as your account is active. If you delete your account,
                your data is deleted from our systems within 30 days, except where retention is required
                for legal or billing purposes (e.g. invoice records).
              </p>
            </section>

            <section>
              <h2 className="text-lg font-semibold mb-3">8. Your rights</h2>
              <p className="text-muted-foreground mb-3">You have the right to:</p>
              <ul className="list-disc list-inside space-y-2 text-muted-foreground">
                <li>Access the data we hold about you.</li>
                <li>Request correction of inaccurate data.</li>
                <li>Request deletion of your account and associated data.</li>
                <li>Opt out of internal model improvement data use (Settings → Data &amp; Privacy).</li>
              </ul>
              <p className="text-muted-foreground mt-3">
                To exercise any of these rights, contact us at{" "}
                <a href="mailto:support@truckcast.app" className="text-primary hover:underline">
                  support@truckcast.app
                </a>.
              </p>
            </section>

            <section>
              <h2 className="text-lg font-semibold mb-3">9. Changes to this policy</h2>
              <p className="text-muted-foreground">
                We may update this policy from time to time. If we make material changes, we will
                notify you by email or via an in-app notice. Continued use of TruckCast after
                changes take effect constitutes acceptance of the revised policy.
              </p>
            </section>

          </div>
        </div>
      </main>

      <footer className="border-t py-6">
        <div className="container mx-auto px-4 text-center text-sm text-muted-foreground">
          <Link href="/terms" className="hover:underline">Terms of Service</Link>
          {" · "}
          <Link href="/help" className="hover:underline">Help Center</Link>
          {" · "}
          <Link href="/" className="hover:underline">Home</Link>
        </div>
      </footer>
    </div>
  );
}
