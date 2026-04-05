"use client";

import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { ChevronDown, ChevronUp, Info } from "lucide-react";

export function ForecastExplainer() {
  const [open, setOpen] = useState(false);

  return (
    <Card>
      <CardContent className="pt-4 pb-4">
        <div className="space-y-3">
          <div className="flex items-start gap-3">
            <Info className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
            <p className="text-sm text-muted-foreground">
              TruckCast forecasts are based on your event history. We analyze past events with the
              same name, type, and location to predict your likely revenue. The more events you log,
              the more accurate your forecasts become.
            </p>
          </div>

          <button
            onClick={() => setOpen(!open)}
            className="flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
          >
            {open ? (
              <>
                <ChevronUp className="h-4 w-4" />
                Hide: How is this calculated?
              </>
            ) : (
              <>
                <ChevronDown className="h-4 w-4" />
                How is this calculated?
              </>
            )}
          </button>

          {open && (
            <div className="border rounded-lg p-4 space-y-3 text-sm text-muted-foreground bg-muted/30">
              <p className="font-medium text-foreground">
                TruckCast uses a 4-level fallback system to generate the best possible forecast:
              </p>
              <ol className="space-y-2 list-none">
                <li className="flex gap-3">
                  <span className="flex-shrink-0 w-6 h-6 rounded-full bg-primary/10 text-primary text-xs font-bold flex items-center justify-center">1</span>
                  <div>
                    <span className="font-medium text-foreground">Direct history</span> — If you&apos;ve done this exact event before (same name), we use your actual past results as the starting point. This gives the most accurate forecast.
                  </div>
                </li>
                <li className="flex gap-3">
                  <span className="flex-shrink-0 w-6 h-6 rounded-full bg-primary/10 text-primary text-xs font-bold flex items-center justify-center">2</span>
                  <div>
                    <span className="font-medium text-foreground">Similar events</span> — If this is a new event but you&apos;ve done similar ones (same type and location), we use those as a reference.
                  </div>
                </li>
                <li className="flex gap-3">
                  <span className="flex-shrink-0 w-6 h-6 rounded-full bg-primary/10 text-primary text-xs font-bold flex items-center justify-center">3</span>
                  <div>
                    <span className="font-medium text-foreground">Event type average</span> — If we only have history for this event type (e.g., farmers markets), we average all your farmers market events.
                  </div>
                </li>
                <li className="flex gap-3">
                  <span className="flex-shrink-0 w-6 h-6 rounded-full bg-primary/10 text-primary text-xs font-bold flex items-center justify-center">4</span>
                  <div>
                    <span className="font-medium text-foreground">Seasonal average</span> — For brand new event types with no history, we fall back to your overall average adjusted for the season.
                  </div>
                </li>
              </ol>
              <p className="text-xs">
                On top of the base forecast, we apply adjustments for weather conditions and day of week based on patterns in your data. Confidence is rated <span className="text-green-600 font-medium">High</span>, <span className="text-yellow-600 font-medium">Medium</span>, or <span className="text-red-600 font-medium">Low</span> based on how much historical data we have.
              </p>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
