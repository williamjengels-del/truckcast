import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { ErrorBoundary } from "@/components/error-boundary";
import { GlobalErrorHandler } from "@/components/global-error-handler";
import { PWARegister } from "@/components/pwa-register";
import { TooltipProvider } from "@/components/ui/tooltip";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "TruckCast by VendCast — Event Forecasting for Food Trucks",
  description:
    "Forecast event revenue, track performance, and optimize booking decisions for your food truck business. A VendCast product.",
  metadataBase: new URL("https://vendcast.co"),
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "TruckCast",
  },
  openGraph: {
    type: "website",
    siteName: "VendCast",
    url: "https://vendcast.co",
    title: "TruckCast by VendCast — Event Forecasting for Food Trucks",
    description:
      "Forecast event revenue, track performance, and optimize booking decisions for your food truck business.",
  },
  twitter: {
    card: "summary_large_image",
    title: "TruckCast by VendCast — Event Forecasting for Food Trucks",
    description:
      "Forecast event revenue, track performance, and optimize booking decisions for your food truck business.",
  },
  alternates: {
    canonical: "https://vendcast.co",
  },
  other: {
    "mobile-web-app-capable": "yes",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <PWARegister />
        <GlobalErrorHandler />
        <TooltipProvider>
          <ErrorBoundary>{children}</ErrorBoundary>
        </TooltipProvider>
      </body>
    </html>
  );
}
