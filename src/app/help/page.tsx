import type { Metadata } from "next";
import Link from "next/link";
import { TruckIcon, ChevronRight } from "lucide-react";

export const metadata: Metadata = {
  title: "Help Center — TruckCast",
  description: "Answers to common questions about TruckCast — forecasting, events, POS integrations, billing, and more.",
};

const sections = [
  {
    title: "Getting Started",
    slug: "getting-started",
    faqs: [
      {
        q: "How do I add my first event?",
        a: "Go to Dashboard → Events and click \"Add Event\". Fill in the event name, date, location, and event type. You can enter the net sales after the event is complete.",
      },
      {
        q: "What is a \"net sales\" figure?",
        a: "Net sales is the total revenue from food and drink sales before subtracting any venue fees or commissions. Do not subtract credit card processing fees — TruckCast handles fee types separately through the fee calculator.",
      },
      {
        q: "How do I import my historical data?",
        a: "Go to Dashboard → Events → Import CSV. Your CSV needs at minimum an event_name and event_date column. We also accept net_sales, event_type, location, fee_type, fee_rate, and notes. Dates can be YYYY-MM-DD or M/D/YYYY format.",
      },
      {
        q: "What happens during onboarding?",
        a: "Onboarding walks you through four steps: set your business profile, import historical events, optionally connect your POS system, and add your upcoming events. The more history you import, the better your forecasts will be from day one.",
      },
    ],
  },
  {
    title: "Forecasting",
    slug: "forecasting",
    faqs: [
      {
        q: "How does the forecast engine work?",
        a: "TruckCast uses a four-level hierarchy. First, it looks for direct history for that exact event. If there isn't enough, it falls back to similar events (same type + area), then to all events of that type, and finally to your monthly average. It tells you which level was used so you know how confident to be.",
      },
      {
        q: "Why does my forecast show LOW confidence?",
        a: "Confidence is LOW when you have fewer than 2 data points for an event, or when the sales are inconsistent. Add more event history or log the event a few more times to move to MEDIUM or HIGH confidence.",
      },
      {
        q: "How does weather affect the forecast?",
        a: "TruckCast applies a weather coefficient to outdoor events based on the forecast for that day. Rain During Event = 53% of normal, Storms = 30%, Hot (90°F+) = 63%, Cold (≤40°F) = 55%. These coefficients come from 244+ real Wok-O Taco events and recalibrate as your own data accumulates.",
      },
      {
        q: "Can I override a forecast?",
        a: "Not directly — the forecast is calculated automatically. If you believe an event will outperform or underperform (e.g., larger expected crowd), add a note to the event explaining why. Manual adjustments are planned for a future update.",
      },
    ],
  },
  {
    title: "Events & Performance",
    slug: "events",
    faqs: [
      {
        q: "What is the Event Performance table?",
        a: "The Performance table aggregates your history for each recurring event — average sales, min/max, consistency score, year-over-year trend, and confidence. It recalculates automatically whenever you add or update sales data.",
      },
      {
        q: "What does \"anomaly flag\" mean?",
        a: "Anomaly flags mark events that performed unusually. \"Disrupted\" events (weather cancellation, venue issue, etc.) are excluded from performance calculations so they don't skew your averages. \"Boosted\" events performed unusually well.",
      },
      {
        q: "What are event tiers (A, B, C, D)?",
        a: "Tiers are your personal rating for each event: A = destination events with high attendance and strong branding, B = solid recurring bread-and-butter events, C = smaller or newer events worth monitoring, D = low-value events not worth rebooking.",
      },
      {
        q: "How does the fee calculator work?",
        a: "Select a fee type when logging an event: Flat Fee (deduct a fixed amount), Percentage (deduct % of sales), Commission with Minimum (% of whichever is greater — actual sales or the guaranteed minimum), or Pre-Settled (settlement already happened, net sales is already the take-home).",
      },
    ],
  },
  {
    title: "POS Integrations",
    slug: "pos",
    faqs: [
      {
        q: "Which POS systems are supported?",
        a: "TruckCast supports Square (OAuth), Clover (OAuth), and Toast (email parsing). POS integrations require a Pro or Premium subscription.",
      },
      {
        q: "How does Toast integration work?",
        a: "Toast's API is restricted to enterprise partners, so TruckCast uses email parsing instead. After each service, Toast sends you a daily summary email. Go to Settings → POS → Toast, set up your account, then paste that email into the import panel to pull in your sales.",
      },
      {
        q: "How often does Square/Clover sync?",
        a: "Syncing runs daily at 7 AM in your timezone and pulls the previous day's orders. You can also trigger a manual sync anytime from Settings → POS.",
      },
      {
        q: "What does the sync do with my sales data?",
        a: "It matches the POS order total to a booked event on that date and updates the net_sales field. If multiple events are booked on the same day, it will prompt you to select which one to apply the sales to.",
      },
    ],
  },
  {
    title: "Billing & Plans",
    slug: "billing",
    faqs: [
      {
        q: "What's included in each plan?",
        a: "Starter ($29/mo): manual event tracking, fee calculator, performance table, basic dashboard. Pro ($79/mo): adds POS integrations, weather forecasts, public schedule page. Premium ($149/mo): adds organizer quality scoring, risk analysis, monthly reports, confidence bands.",
      },
      {
        q: "Is there an annual discount?",
        a: "Yes — annual plans save about 17% versus monthly. Starter annual is $290, Pro is $790, Premium is $1,490.",
      },
      {
        q: "How do I change or cancel my plan?",
        a: "Go to Dashboard → Settings → Billing and click \"Manage Subscription\". This opens the Stripe billing portal where you can upgrade, downgrade, or cancel.",
      },
      {
        q: "Can I try TruckCast before paying?",
        a: "Yes — every new account gets a 14-day free trial with no credit card required. Sign up at vendcast.co and you'll have full access from day one.",
      },
    ],
  },
  {
    title: "Privacy & Data",
    slug: "privacy",
    faqs: [
      {
        q: "Can other TruckCast users see my data?",
        a: "No. TruckCast enforces strict tenant isolation — your events, sales, contacts, and forecasts are only visible to you. Row-level security is enforced at the database level.",
      },
      {
        q: "Are my POS credentials stored securely?",
        a: "Yes. OAuth tokens for Square and Clover are stored encrypted in Supabase Vault and are never exposed to the client or transmitted in logs.",
      },
      {
        q: "Can I export my data?",
        a: "CSV export is on the roadmap. Currently you can view all your data in the Events and Performance tables. Contact support if you need a data export urgently.",
      },
    ],
  },
];

export default function HelpPage() {
  return (
    <div className="flex flex-col min-h-screen">
      {/* Nav */}
      <header className="border-b">
        <div className="container mx-auto flex h-16 items-center justify-between px-4">
          <Link href="/" className="flex items-center gap-2">
            <TruckIcon className="h-7 w-7 text-primary" />
            <span className="text-xl font-bold">TruckCast</span>
          </Link>
          <div className="flex items-center gap-3 text-sm text-muted-foreground">
            <Link href="/login" className="hover:text-foreground transition-colors">Sign in</Link>
            <Link href="/signup" className="hover:text-foreground transition-colors">Get started</Link>
          </div>
        </div>
      </header>

      <main className="flex-1">
        {/* Hero */}
        <div className="border-b bg-muted/30 py-12">
          <div className="container mx-auto px-4 text-center">
            <h1 className="text-3xl font-bold">Help Center</h1>
            <p className="mt-2 text-muted-foreground">
              Everything you need to get the most out of TruckCast
            </p>
          </div>
        </div>

        <div className="container mx-auto px-4 py-12 max-w-4xl">
          {/* Jump links */}
          <div className="flex flex-wrap gap-2 mb-10">
            {sections.map((s) => (
              <a
                key={s.slug}
                href={`#${s.slug}`}
                className="text-sm px-3 py-1.5 rounded-full border hover:bg-muted transition-colors"
              >
                {s.title}
              </a>
            ))}
          </div>

          {/* FAQ sections */}
          <div className="space-y-14">
            {sections.map((section) => (
              <section key={section.slug} id={section.slug}>
                <h2 className="text-xl font-bold mb-6 pb-2 border-b">{section.title}</h2>
                <div className="space-y-6">
                  {section.faqs.map((faq) => (
                    <div key={faq.q} className="space-y-2">
                      <div className="flex items-start gap-2">
                        <ChevronRight className="h-4 w-4 text-primary mt-0.5 shrink-0" />
                        <h3 className="font-semibold text-sm">{faq.q}</h3>
                      </div>
                      <p className="text-sm text-muted-foreground pl-6">{faq.a}</p>
                    </div>
                  ))}
                </div>
              </section>
            ))}
          </div>

          {/* Contact footer */}
          <div className="mt-14 rounded-lg border bg-muted/30 p-6 text-center">
            <p className="font-semibold">Still have questions?</p>
            <p className="text-sm text-muted-foreground mt-1">
              Reach out and Julian will get back to you personally.
            </p>
            <a
              href="mailto:support@truckcast.app"
              className="mt-3 inline-block text-sm text-primary hover:underline"
            >
              support@truckcast.app
            </a>
          </div>
        </div>
      </main>

      <footer className="border-t py-6">
        <div className="container mx-auto px-4 text-center text-sm text-muted-foreground">
          &copy; {new Date().getFullYear()} TruckCast.{" "}
          <Link href="/" className="hover:underline">Back to home</Link>
        </div>
      </footer>
    </div>
  );
}
