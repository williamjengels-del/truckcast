import type { Metadata } from "next";
import { ForecastCalculator } from "@/components/forecast-calculator";

export const metadata: Metadata = {
  title: "Free Food Truck Revenue Estimator | TruckCast",
  description:
    "Estimate how much your food truck will make at any event — festivals, corporate, catering, and more. Free tool, no signup required.",
  openGraph: {
    title: "Free Food Truck Revenue Estimator",
    description:
      "Find out if an event is worth booking before you commit. Enter attendance, event type, and conditions to get an instant revenue estimate.",
    url: "https://truckcast.co/tools/calculator",
    siteName: "TruckCast",
    type: "website",
  },
};

export default function PublicCalculatorPage() {
  return (
    <div className="min-h-screen bg-background">
      {/* Nav strip */}
      <header className="border-b bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60 sticky top-0 z-50">
        <div className="max-w-4xl mx-auto px-4 h-14 flex items-center justify-between">
          <a href="/" className="flex items-center gap-2 font-semibold text-sm">
            <span className="text-xl">🚚</span>
            <div className="flex flex-col leading-none">
              <span className="font-bold">TruckCast</span>
              <span className="text-[10px] text-muted-foreground font-medium tracking-wide">by VendCast</span>
            </div>
          </a>
          <div className="flex items-center gap-3">
            <a
              href="/login"
              className="text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              Sign in
            </a>
            <a
              href="/signup"
              className="text-sm bg-primary text-primary-foreground rounded-md px-3 py-1.5 font-medium hover:bg-primary/90 transition-colors"
            >
              Start free trial
            </a>
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

      {/* Footer */}
      <footer className="border-t mt-12 py-6">
        <div className="max-w-4xl mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-muted-foreground">
          <span>© {new Date().getFullYear()} VendCast · TruckCast is built for food truck operators, by a food truck operator</span>
          <div className="flex gap-4">
            <a href="/privacy" className="hover:text-foreground transition-colors">Privacy</a>
            <a href="/terms" className="hover:text-foreground transition-colors">Terms</a>
            <a href="/signup" className="hover:text-foreground transition-colors">Sign up free</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
