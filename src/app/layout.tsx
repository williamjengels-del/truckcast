import type { Metadata, Viewport } from "next";
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
  title: "VendCast — Event Forecasting for Food Trucks & Mobile Vendors",
  description:
    "Forecast event revenue, track performance, and optimize booking decisions for food trucks and mobile vendors. A VendCast product.",
  metadataBase: new URL("https://vendcast.co"),
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "VendCast",
  },
  icons: {
    icon: [
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    // iOS home-screen icon — Apple uses 180×180; the 192 asset scales
    // down cleanly and is what Safari reaches for.
    apple: [{ url: "/icon-192.png", sizes: "192x192", type: "image/png" }],
  },
  openGraph: {
    type: "website",
    siteName: "VendCast",
    url: "https://vendcast.co",
    title: "VendCast — Event Forecasting for Food Trucks & Mobile Vendors",
    description:
      "Forecast event revenue, track performance, and optimize booking decisions for food trucks and mobile vendors.",
  },
  twitter: {
    card: "summary_large_image",
    title: "VendCast — Event Forecasting for Food Trucks & Mobile Vendors",
    description:
      "Forecast event revenue, track performance, and optimize booking decisions for food trucks and mobile vendors.",
  },
  alternates: {
    canonical: "https://vendcast.co",
  },
  other: {
    "mobile-web-app-capable": "yes",
  },
};

export const viewport: Viewport = {
  themeColor: "#f97316",
  width: "device-width",
  initialScale: 1,
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
