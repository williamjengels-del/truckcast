import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "TruckCast — Sign In or Create Account",
  description: "Sign in or create your TruckCast account to start forecasting food truck event revenue.",
};

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
