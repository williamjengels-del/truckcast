import type { Metadata } from "next";
import Link from "next/link";
import { ForecastCalculator } from "@/components/forecast-calculator";
import { FindVendorLink } from "@/components/find-vendor-link";
import { MarketingFooter } from "@/components/marketing-footer";

export const metadata: Metadata = {
  title: "Free Food Truck Revenue Estimator | VendCast",
  description:
    "Estimate how much your food truck will make at any event — festivals, corporate, catering, and more. Free tool, no signup required.",
  openGraph: {
    title: "Free Food Truck Revenue Estimator",
    description:
      "Find out if an event is worth booking before you commit. Enter attendance, event type, and conditions to get an instant revenue estimate.",
    url: "https://vendcast.co/tools/calculator",
    siteName: "VendCast",
    type: "website",
  },
};

export default function PublicCalculatorPage() {
  return (
    <div className="min-h-screen bg-background">
      {/* Nav strip */}
      <header className="border-b bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60 sticky top-0 z-50">
        <div className="max-w-4xl mx-auto px-4 h-14 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2 font-semibold text-sm">
            <span className="text-xl">🚚</span>
            <span className="font-bold">VendCast</span>
          </Link>
          <div className="flex items-center gap-3">
            <FindVendorLink />
            <Link
              href="/login"
              className="text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              Sign in
            </Link>
            <Link
              href="/signup"
              className="text-sm bg-primary text-primary-foreground rounded-md px-3 py-1.5 font-medium hover:bg-primary/90 transition-colors"
            >
              Start free trial
            </Link>
          </div>
        </div>
      </header>

      {/* Hero blurb */}
      <div className="bg-orange-50 dark:bg-orange-950/20 border-b border-orange-100 dark:border-orange-900/20">
        <div className="max-w-4xl mx-auto px-4 py-5 text-center">
          <p className="text-sm text-orange-700 dark:text-orange-400 font-medium">
            Free estimator — sign up to calibrate with your own data for 2-3× more accuracy
          </p>
        </div>
      </div>

      {/* Calculator */}
      <main className="max-w-4xl mx-auto px-4 py-8">
        <ForecastCalculator
          historicalEvents={[]}
          overallAvg={null}
          eventTypeAvgs={{}}
          calibratedCoefficients={null}
          isPublic={true}
        />
      </main>

      <MarketingFooter />
    </div>
  );
}
