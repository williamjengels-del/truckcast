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
import { ChevronDown, ChevronUp, PiggyBank } from "lucide-react";
import type { Event } from "@/lib/database.types";

interface CostData {
  food_cost?: number;
  labor_cost?: number;
  other_costs?: number;
}

interface SalesEntryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  event: Event | null;
  onSubmit: (
    eventId: string,
    netSales: number,
    invoiceRevenue: number,
    weather?: string,
    costs?: CostData
  ) => Promise<void>;
}

function parseCost(val: string): number | undefined {
  if (val.trim() === "") return undefined;
  const n = parseFloat(val.replace(/[$,]/g, ""));
  return isNaN(n) || n < 0 ? undefined : n;
}

export function SalesEntryDialog({
  open,
  onOpenChange,
  event,
  onSubmit,
}: SalesEntryDialogProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showCosts, setShowCosts] = useState(false);

  // Live cost preview state
  const [salesPreview, setSalesPreview] = useState<number | null>(null);
  const [invoicePreview, setInvoicePreview] = useState<number | null>(null);
  const [foodCostPreview, setFoodCostPreview] = useState<number | null>(null);
  const [laborCostPreview, setLaborCostPreview] = useState<number | null>(null);
  const [otherCostPreview, setOtherCostPreview] = useState<number | null>(null);

  // When no event is selected, render the Dialog shell but nothing inside
  if (!event) {
    return <Dialog open={false} onOpenChange={onOpenChange}><DialogContent /></Dialog>;
  }

  const isCatering = event.event_mode === "catering";
  const hasPriorCosts = event.food_cost !== null || event.labor_cost !== null || event.other_costs !== null;

  // Profit preview calculation
  const previewRevenue = (salesPreview ?? (event.net_sales ?? 0)) +
    (isCatering ? (invoicePreview ?? (event.invoice_revenue ?? 0)) : 0);
  const previewCosts =
    (foodCostPreview ?? (showCosts ? 0 : null) ?? 0) +
    (laborCostPreview ?? (showCosts ? 0 : null) ?? 0) +
    (otherCostPreview ?? (showCosts ? 0 : null) ?? 0);
  const hasCostInput = showCosts && (foodCostPreview !== null || laborCostPreview !== null || otherCostPreview !== null);
  const previewProfit = hasCostInput ? previewRevenue - previewCosts : null;
  const previewMargin = previewProfit !== null && previewRevenue > 0
    ? (previewProfit / previewRevenue) * 100
    : null;

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const form = new FormData(e.currentTarget);
    const netSalesRaw = form.get("net_sales") as string;
    const netSales = netSalesRaw === "" ? 0 : Number(netSalesRaw);
    const invoiceRevenue = Number(form.get("invoice_revenue") ?? 0) || 0;
    const weather = form.get("event_weather") as string | undefined;

    if (isNaN(netSales) || netSales < 0) {
      setError("Please enter a valid sales amount");
      setLoading(false);
      return;
    }

    if (isCatering && netSales === 0 && invoiceRevenue === 0) {
      setError("Please enter at least an invoice amount or on-site sales");
      setLoading(false);
      return;
    }

    if (!isCatering && netSales === 0 && netSalesRaw === "") {
      setError("Please enter your POS sales amount");
      setLoading(false);
      return;
    }

    // Parse cost fields if section is open
    let costs: CostData | undefined;
    if (showCosts) {
      const fc = parseCost(form.get("food_cost") as string ?? "");
      const lc = parseCost(form.get("labor_cost") as string ?? "");
      const oc = parseCost(form.get("other_costs") as string ?? "");
      if (fc !== undefined || lc !== undefined || oc !== undefined) {
        costs = { food_cost: fc, labor_cost: lc, other_costs: oc };
      }
    }

    try {
      await onSubmit(event!.id, netSales, invoiceRevenue, weather || undefined, costs);
      // Reset preview state
      setSalesPreview(null);
      setInvoicePreview(null);
      setFoodCostPreview(null);
      setLaborCostPreview(null);
      setOtherCostPreview(null);
      setShowCosts(false);
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => {
      if (!o) {
        setSalesPreview(null);
        setInvoicePreview(null);
        setFoodCostPreview(null);
        setLaborCostPreview(null);
        setOtherCostPreview(null);
        setShowCosts(false);
      }
      onOpenChange(o);
    }}>
      <DialogContent className="max-w-md w-[95vw] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isCatering ? "Log Catering Revenue" : "Enter Sales"}</DialogTitle>
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
          {isCatering ? (
            <>
              <div className="space-y-2">
                <Label htmlFor="invoice_revenue">Invoice Amount ($)</Label>
                <Input
                  id="invoice_revenue"
                  name="invoice_revenue"
                  type="number"
                  step="0.01"
                  min="0"
                  defaultValue={event.invoice_revenue > 0 ? event.invoice_revenue : ""}
                  placeholder="0.00"
                  autoFocus
                  onChange={(e) => setInvoicePreview(parseFloat(e.target.value) || null)}
                />
                <p className="text-xs text-muted-foreground">
                  The amount invoiced to the client for this catering event.
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="net_sales">On-site POS Sales ($) <span className="text-muted-foreground font-normal">(optional)</span></Label>
                <Input
                  id="net_sales"
                  name="net_sales"
                  type="number"
                  step="0.01"
                  min="0"
                  defaultValue={event.net_sales ?? ""}
                  placeholder="0.00"
                  onChange={(e) => setSalesPreview(parseFloat(e.target.value) || null)}
                />
                <p className="text-xs text-muted-foreground">
                  Any additional POS sales at the event (e.g., walk-up orders).
                </p>
              </div>
            </>
          ) : (
            <>
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
                  onChange={(e) => setSalesPreview(parseFloat(e.target.value) || null)}
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
            </>
          )}

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

          {/* Cost tracking — collapsible optional section */}
          <div className="border rounded-lg overflow-hidden">
            <button
              type="button"
              className="w-full flex items-center justify-between px-3 py-2.5 text-sm font-medium hover:bg-muted/50 transition-colors text-left"
              onClick={() => setShowCosts(!showCosts)}
            >
              <span className="flex items-center gap-2">
                <PiggyBank className="h-4 w-4 text-muted-foreground" />
                {hasPriorCosts ? "Update costs" : "Track costs"}
                <span className="text-xs font-normal text-muted-foreground">(optional)</span>
              </span>
              {showCosts ? (
                <ChevronUp className="h-4 w-4 text-muted-foreground" />
              ) : (
                <ChevronDown className="h-4 w-4 text-muted-foreground" />
              )}
            </button>

            {showCosts && (
              <div className="px-3 pb-3 pt-1 space-y-3 border-t bg-muted/20">
                <div className="grid grid-cols-3 gap-2">
                  <div className="space-y-1">
                    <Label htmlFor="food_cost" className="text-xs">Food ($)</Label>
                    <Input
                      id="food_cost"
                      name="food_cost"
                      type="number"
                      step="0.01"
                      min="0"
                      defaultValue={event.food_cost ?? ""}
                      placeholder="0.00"
                      className="text-sm h-8"
                      onChange={(e) => setFoodCostPreview(parseFloat(e.target.value) || null)}
                    />
                    <p className="text-[10px] text-muted-foreground">Ingredients</p>
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="labor_cost" className="text-xs">Labor ($)</Label>
                    <Input
                      id="labor_cost"
                      name="labor_cost"
                      type="number"
                      step="0.01"
                      min="0"
                      defaultValue={event.labor_cost ?? ""}
                      placeholder="0.00"
                      className="text-sm h-8"
                      onChange={(e) => setLaborCostPreview(parseFloat(e.target.value) || null)}
                    />
                    <p className="text-[10px] text-muted-foreground">Staff, you</p>
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="other_costs" className="text-xs">Other ($)</Label>
                    <Input
                      id="other_costs"
                      name="other_costs"
                      type="number"
                      step="0.01"
                      min="0"
                      defaultValue={event.other_costs ?? ""}
                      placeholder="0.00"
                      className="text-sm h-8"
                      onChange={(e) => setOtherCostPreview(parseFloat(e.target.value) || null)}
                    />
                    <p className="text-[10px] text-muted-foreground">Fuel, supplies</p>
                  </div>
                </div>

                {/* Live profit preview */}
                {hasCostInput && previewProfit !== null && (
                  <div className={`rounded-md px-3 py-2 text-sm flex items-center justify-between ${previewProfit >= 0 ? "bg-green-50 dark:bg-green-950/20 border border-green-200 dark:border-green-800" : "bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800"}`}>
                    <span className="text-muted-foreground text-xs">Net profit</span>
                    <div className="text-right">
                      <span className={`font-semibold ${previewProfit >= 0 ? "text-green-700 dark:text-green-400" : "text-red-600"}`}>
                        ${Math.abs(previewProfit).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        {previewProfit < 0 && " loss"}
                      </span>
                      {previewMargin !== null && (
                        <span className="ml-2 text-xs text-muted-foreground">
                          {previewMargin.toFixed(1)}% margin
                        </span>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

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
              {loading ? "Saving..." : "Save"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
