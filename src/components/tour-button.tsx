"use client";

import { useState } from "react";
import { HelpCircle } from "lucide-react";
import { WelcomeTour } from "@/components/welcome-tour";

export function TourButton() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        title="Quick tour"
        className="p-1.5 rounded-full hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
      >
        <HelpCircle className="h-5 w-5" />
      </button>

      {open && (
        <WelcomeTour forceOpen={true} onClose={() => setOpen(false)} />
      )}
    </>
  );
}
