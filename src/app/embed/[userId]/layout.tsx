import { Geist, Geist_Mono } from "next/font/google";
import "../../globals.css";

// The embed page renders inside operators' iframes on their own
// websites — separate <html> root from the main app layout. Without
// loading Geist here too, inline-style font-family fell back to the
// browser's system stack on the embed (`system-ui`), so the widget
// looked off-brand on every operator's site. Mirror the main
// layout's font loader so the variables resolve inside the embed
// document and inline `fontFamily: var(--font-geist-sans)` works.
const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export default function EmbedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable}`}>
      <body style={{ margin: 0, padding: 0, background: "transparent" }}>
        {children}
      </body>
    </html>
  );
}
