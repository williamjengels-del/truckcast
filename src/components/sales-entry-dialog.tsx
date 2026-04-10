"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { Event } from "@/lib/database.types";

interface SalesEntryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  event: Event | null;
  onSubmit: (
    eventId: string,
    netSales: number,
    invoiceRevenue: number,
    weather?: string
  ) => Promise<void>;
}

export function SalesEntryDialog({
  open,
  onOpenChange,
  event,
  onSubmit,
}: SalesEntryDialogProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // When no event is selected, render the Dialog shell but nothing inside
  // (keeps the Base UI dialog mounted so open/close transitions work)
  if (!event) {
    return <Dialog open={false} onOpenChange={onOpenChange}><DialogContent /></Dialog>;
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const form = new FormData(e.currentTarget);
    const netSales = Number(form.get("net_sales"));
    const invoiceRevenue = Number(form.get("invoice_revenue") ?? 0) || 0;
    const weather = form.get("event_weather") as string | undefined;

    if (isNaN(netSales) || netSales < 0) {
      setError("Please enter a valid sales amount");
      setLoading(false);
      return;
    }

    try {
      await onSubmit(event!.id, netSales, invoiceRevenue, weather || undefined);
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md w-[95vw] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Enter Sales</DialogTitle>
          <DialogDescription>
            {event.event_name} &mdash;{" "}
            {new Date(event.event_date + "T00:00:00").toLocaleDateString("en-US", {
              weekday: "long",
              month: "short",
              day: "numeric",
              year: "numeric",
            })}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="net_sales">POS Sales ($)</Label>
            <Input
              id="net_sales"
              name="net_sales"
              type="number"
              step="0.01"
              min="0"
              defaultValue={event.net_sales ?? ""}
              placeholder="0.00"
              autoFocus
              required
            />
            <p className="text-xs text-muted-foreground">
              Sales from your POS terminal — minus tax and tips. Used for forecasting.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="invoice_revenue">Invoice Revenue ($) <span className="text-muted-foreground font-normal">(optional)</span></Label>
            <Input
              id="invoice_revenue"
              name="invoice_revenue"
              type="number"
              step="0.01"
              min="0"
              defaultValue={event.invoice_revenue > 0 ? event.invoice_revenue : ""}
              placeholder="0.00"
            />
            <p className="text-xs text-muted-foreground">
              Catering deposits, net-30 payments, or any invoice paid for this event. Tracked separately — won&apos;t skew your forecast.
            </p>
          </div>

          {!event.event_weather && (
            <div className="space-y-2">
              <Label htmlFor="event_weather">Weather (optional)</Label>
              <Select name="event_weather" defaultValue="">
                <SelectTrigger>
                  <SelectValue placeholder="How was the weather?" />
                </SelectTrigger>
                <SelectContent>
                  {[
                    "Clear",
                    "Overcast",
                    "Hot",
                    "Cold",
                    "Rain Before Event",
                    "Rain During Event",
                    "Storms",
                    "Snow",
                  ].map((w) => (
                    <SelectItem key={w} value={w}>
                      {w}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {event.forecast_sales && (
            <p className="text-sm text-muted-foreground">
              Forecast was:{" "}
              <span className="font-medium text-foreground">
                ${event.forecast_sales.toLocaleString()}
              </span>
            </p>
          )}

          {error && <p className="text-sm text-destructive">{error}</p>}

          <div className="flex justify-end gap-3">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={loading}>
              {loading ? "Saving..." : "Save Sales"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
