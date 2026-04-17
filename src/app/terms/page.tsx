import type { Metadata } from "next";
import Link from "next/link";
import { TruckIcon } from "lucide-react";

export const metadata: Metadata = {
  title: "Terms of Service — VendCast",
  description: "The terms governing your use of VendCast.",
};

export default function TermsPage() {
  return (
    <div className="flex flex-col min-h-screen">
      <header className="border-b">
        <div className="container mx-auto flex h-16 items-center justify-between px-4">
          <Link href="/" className="flex items-center gap-2">
            <TruckIcon className="h-7 w-7 text-primary" />
            <span className="text-xl font-bold">VendCast</span>
          </Link>
        </div>
      </header>

      <main className="flex-1">
        <div className="container mx-auto px-4 py-12 max-w-3xl prose prose-neutral dark:prose-invert">
          <h1 className="text-3xl font-bold mb-2">Terms of Service</h1>
          <p className="text-muted-foreground text-sm mb-8">Last updated: April 3, 2026</p>

          <div className="space-y-8 text-sm leading-relaxed">

            <section>
              <h2 className="text-lg font-semibold mb-3">1. Acceptance of terms</h2>
              <p className="text-muted-foreground">
                By creating an account or using VendCast (&ldquo;the Service&rdquo;), you agree to be
                bound by these Terms of Service (&ldquo;Terms&rdquo;). The Service is operated by Julian
                Engels (&ldquo;we,&rdquo; &ldquo;us,&rdquo; or &ldquo;our&rdquo;). If you do not agree to
                these Terms, do not use VendCast.
              </p>
            </section>

            <section>
              <h2 className="text-lg font-semibold mb-3">2. Description of the service</h2>
              <p className="text-muted-foreground">
                VendCast is a software-as-a-service platform that helps food truck operators forecast
                event revenue, track sales performance, and manage booking decisions. Features vary by
                subscription tier. We reserve the right to modify, add, or discontinue features at any
                time with reasonable notice.
              </p>
            </section>

            <section>
              <h2 className="text-lg font-semibold mb-3">3. Accounts and eligibility</h2>
              <ul className="list-disc list-inside space-y-2 text-muted-foreground">
                <li>You must be at least 18 years old to create an account.</li>
                <li>You are responsible for maintaining the security of your login credentials.</li>
                <li>You may not share your account with others or create accounts on behalf of third parties without authorization.</li>
                <li>One business entity per account. Separate accounts are required for separate businesses.</li>
              </ul>
            </section>

            <section>
              <h2 className="text-lg font-semibold mb-3">4. Subscriptions and billing</h2>
              <p className="text-muted-foreground mb-3">
                VendCast is offered on a recurring subscription basis. By subscribing, you authorize us
                to charge your payment method on a monthly or annual basis at the rates in effect at the
                time of billing.
              </p>
              <ul className="list-disc list-inside space-y-2 text-muted-foreground">
                <li>Subscriptions renew automatically unless cancelled before the renewal date.</li>
                <li>Downgrades take effect at the end of the current billing period.</li>
                <li>We do not offer refunds for partial billing periods, except where required by law.</li>
                <li>Prices may change with 30 days&rsquo; advance notice to your registered email.</li>
              </ul>
            </section>

            <section>
              <h2 className="text-lg font-semibold mb-3">5. Acceptable use</h2>
              <p className="text-muted-foreground mb-3">You agree not to:</p>
              <ul className="list-disc list-inside space-y-2 text-muted-foreground">
                <li>Use VendCast for any unlawful purpose.</li>
                <li>Attempt to access another user&apos;s data or circumvent Row Level Security controls.</li>
                <li>Reverse-engineer, scrape, or automate requests to the Service in ways not intended by its design.</li>
                <li>Introduce malicious code, spam, or content that violates others&apos; rights.</li>
                <li>Use the Service to harm, defraud, or deceive any person or entity.</li>
              </ul>
            </section>

            <section className="rounded-lg border border-primary/30 bg-primary/5 p-5">
              <h2 className="text-lg font-semibold mb-3">6. Data you enter and internal model improvement</h2>
              <p className="text-muted-foreground mb-3">
                You retain ownership of the data you enter into VendCast (event records, sales figures,
                notes, etc.). By using the Service, you grant VendCast a limited, non-exclusive license
                to store, process, and display your data to operate the Service.
              </p>
              <p className="text-muted-foreground mb-3">
                By default, your event data may also be accessed by VendCast&apos;s operator
                internally to analyze patterns, validate forecast accuracy, and improve the forecasting
                model. This use is covered in detail in our{" "}
                <Link href="/privacy" className="text-primary hover:underline">
                  Privacy Policy (Section 4)
                </Link>
                . You can opt out at any time in Dashboard → Settings → Data &amp; Privacy.
              </p>
              <p className="text-muted-foreground">
                Your data is never sold or shared with third parties outside the services listed in the
                Privacy Policy.
              </p>
            </section>

            <section>
              <h2 className="text-lg font-semibold mb-3">7. Forecasts and accuracy</h2>
              <p className="text-muted-foreground">
                VendCast forecasts are estimates based on historical data and algorithmic modeling.
                They are provided for informational and planning purposes only. We make no guarantee
                that forecasts will match actual results. You are solely responsible for business
                decisions made using VendCast data.
              </p>
            </section>

            <section>
              <h2 className="text-lg font-semibold mb-3">8. Third-party integrations</h2>
              <p className="text-muted-foreground">
                VendCast connects to third-party services including Square, Clover, Toast, Stripe,
                and Open-Meteo. These integrations are provided as-is. We are not responsible for
                outages, data loss, or changes to third-party APIs. Connecting a POS system is
                optional and can be disconnected at any time.
              </p>
            </section>

            <section>
              <h2 className="text-lg font-semibold mb-3">9. Availability and warranties</h2>
              <p className="text-muted-foreground">
                VendCast is provided &ldquo;as is&rdquo; without warranties of any kind, express or
                implied. We do not guarantee uninterrupted, error-free service. We will make
                commercially reasonable efforts to maintain uptime but are not liable for downtime
                outside our control.
              </p>
            </section>

            <section>
              <h2 className="text-lg font-semibold mb-3">10. Limitation of liability</h2>
              <p className="text-muted-foreground">
                To the maximum extent permitted by law, VendCast and its operator shall not be
                liable for indirect, incidental, special, or consequential damages arising from use
                or inability to use the Service, including lost profits or lost data. Our total
                liability in any matter shall not exceed the amount you paid us in the three months
                preceding the claim.
              </p>
            </section>

            <section>
              <h2 className="text-lg font-semibold mb-3">11. Termination</h2>
              <p className="text-muted-foreground">
                You may cancel your account at any time from Dashboard → Settings → Billing. We
                may suspend or terminate accounts that violate these Terms. Upon termination, your
                data is deleted within 30 days as described in the Privacy Policy, except where
                retention is required by law.
              </p>
            </section>

            <section>
              <h2 className="text-lg font-semibold mb-3">12. Governing law</h2>
              <p className="text-muted-foreground">
                These Terms are governed by the laws of the State of Missouri, United States, without
                regard to conflict-of-law provisions. Any disputes shall be resolved in the courts of
                St. Louis County, Missouri, or through binding arbitration if mutually agreed.
              </p>
            </section>

            <section>
              <h2 className="text-lg font-semibold mb-3">13. Changes to these terms</h2>
              <p className="text-muted-foreground">
                We may update these Terms from time to time. Material changes will be communicated
                via email or in-app notice at least 14 days before taking effect. Continued use of
                VendCast after changes take effect constitutes acceptance of the revised Terms.
              </p>
            </section>

            <section>
              <h2 className="text-lg font-semibold mb-3">14. Contact</h2>
              <p className="text-muted-foreground">
                Questions about these Terms can be directed to{" "}
                <a href="mailto:support@vendcast.co" className="text-primary hover:underline">
                  support@vendcast.co
                </a>.
              </p>
            </section>

          </div>
        </div>
      </main>

      <footer className="border-t py-6">
        <div className="container mx-auto px-4 text-center text-sm text-muted-foreground">
          <Link href="/privacy" className="hover:underline">Privacy Policy</Link>
          {" · "}
          <Link href="/help" className="hover:underline">Help Center</Link>
          {" · "}
          <Link href="/" className="hover:underline">Home</Link>
        </div>
      </footer>
    </div>
  );
}
