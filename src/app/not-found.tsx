import Link from "next/link";
import { TruckIcon } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-muted/30 px-4 text-center">
      <TruckIcon className="h-16 w-16 text-muted-foreground/40 mb-6" />
      <h1 className="text-6xl font-bold text-muted-foreground/40 mb-2">404</h1>
      <h2 className="text-xl font-semibold mb-2">Page not found</h2>
      <p className="text-muted-foreground mb-8 max-w-sm">
        Looks like this event got cancelled. The page you&apos;re looking for doesn&apos;t exist.
      </p>
      <div className="flex gap-3">
        <Link href="/dashboard">
          <Button>Go to Dashboard</Button>
        </Link>
        <Link href="/">
          <Button variant="outline">Back to Home</Button>
        </Link>
      </div>
    </div>
  );
}
