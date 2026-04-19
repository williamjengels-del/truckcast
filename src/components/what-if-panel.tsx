"use client";

import { useState, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Zap, TrendingUp, TrendingDown, Minus } from "lucide-react";
import {
  WEATHER_COEFFICIENTS,
  DAY_OF_WEEK_COEFFICIENTS,
  WEATHER_TYPES,
} from "@/lib/constants";
import type { Event } from "@/lib/database.types";
import type { CalibratedCoefficients } from "@/lib/forecast-engine";
import { calcEventFee } from "@/lib/fee-calculator";

// ─── Attendance conversion rates (same as forecast-calculator.tsx) ──────────
// Private / Wedding / Private Party / Reception rates are INITIAL
// ESTIMATES seeded for Commit D. Will be calibrated against real
// operator data in the coefficients workstream.
const CONVERSION_RATES: Record<string, number> = {
  Festival: 0.4,
  Concert: 0.25,
  "Community/Neighborhood": 0.3,
  Corporate: 0.72,
  "Weekly Series": 0.35,
  Private: 0.7, // truck at private venue, captive walk-up
  "Private/Catering": 0.85, // LEGACY — retained for historical rows
  "Sports Event": 0.2,
  "Fundraiser/Charity": 0.35,
  Wedding: 0.85,
  "Private Party": 0.85,
  Reception: 0.85,
};

const FEE_TYPE_LABELS: Record<string, string> = {
  none: "No Fee",
  flat_fee: "Flat Fee ($)",
  percentage: "Percentage (%)",
  commission_with_minimum: "Commission w/ Minimum",
  pre_settled: "Pre-Settled",
};

function formatCurrency(v: number): string {
  return `$${v.toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })}`;
}

// Thin wrapper around shared utility for use in this component
const calcFee = (
  gross: number,
  feeType: string,
  feeRate: number,
  salesMinimum: number
): number => calcEventFee(gross, feeType, feeRate, salesMinimum);

// ─── Types ───────────────────────────────────────────────────────────────────

interface WhatIfPanelProps {
  event: Event;
  /** The forecast amount already calculated by the engine for this event */
  currentForecast: number;
  calibratedCoefficients: CalibratedCoefficients | null;
  eventTypeAvgs: Record<string, number>;
}

// ─── Main component ───────────────────────────────────────────────────────────

export function WhatIfPanel({
  event,
  currentForecast,
  calibratedCoefficients,
  eventTypeAvgs,
}: WhatIfPanelProps) {
  const [open, setOpen] = useState(false);

  // ── Adjustable inputs — pre-filled from event data ──
  const [attendance, setAttendance] = useState(
    String(event.expected_attendance ?? "")
  );
  const [avgTicket, setAvgTicket] = useState("");
  // other_trucks is "other trucks besides yours", so total = other_trucks + 1
  const [numTrucks, setNumTrucks] = useState(
    String((event.other_trucks ?? 0) + 1)
  );
  const [weather, setWeather] = useState(event.event_weather ?? "Clear");
  const [isIndoor, setIsIndoor] = useState(false);
  const [feeType, setFeeType] = useState(event.fee_type ?? "none");
  const [feeRate, setFeeRate] = useState(
    event.fee_rate ? String(event.fee_rate) : ""
  );
  const [salesMinimum, setSalesMinimum] = useState(
    event.sales_minimum ? String(event.sales_minimum) : ""
  );

  // ── Derived historical avg ticket from eventTypeAvgs as fallback ──
  // We don't have avg ticket stored per event, so default to $14
  const DEFAULT_TICKET = 14;

  // ── Live calculation — updates on every input change ──
  const result = useMemo(() => {
    const attendanceNum = parseInt(attendance) || 0;
    const ticketNum = parseFloat(avgTicket) || DEFAULT_TICKET;
    const trucksNum = Math.max(1, parseInt(numTrucks) || 1);
    const feeRateNum = parseFloat(feeRate) || 0;
    const salesMinNum = parseFloat(salesMinimum) || 0;
    const eventType = event.event_type ?? "";

    if (attendanceNum === 0 || !eventType) return null;

    const conversionRate = CONVERSION_RATES[eventType] ?? 0.3;
    const indoorMultiplier = isIndoor ? 1.08 : 1.0;
    const marketShare = 1 / trucksNum;

    const potentialBuyers =
      attendanceNum * conversionRate * indoorMultiplier * marketShare;
    let grossRevenue = potentialBuyers * ticketNum;

    // Weather adjustment (skipped for indoor)
    let weatherCoeff = 1.0;
    if (!isIndoor && weather) {
      const calibW = calibratedCoefficients?.weather[weather];
      weatherCoeff = calibW ?? WEATHER_COEFFICIENTS[weather] ?? 1.0;
      grossRevenue *= weatherCoeff;
    }

    // Day-of-week adjustment using the event's actual date
    let dowCoeff = 1.0;
    if (event.event_date) {
      const dayName = new Date(
        event.event_date + "T00:00:00"
      ).toLocaleDateString("en-US", { weekday: "long" });
      const calibD = calibratedCoefficients?.dayOfWeek[dayName];
      dowCoeff = calibD ?? DAY_OF_WEEK_COEFFICIENTS[dayName] ?? 1.0;
      grossRevenue *= dowCoeff;
    }

    const fee = calcFee(grossRevenue, feeType, feeRateNum, salesMinNum);
    const netRevenue = Math.max(0, grossRevenue - fee);

    const grossRounded = Math.round(grossRevenue);
    const netRounded = Math.round(netRevenue);
    const feeRounded = Math.round(fee);

    const diff = grossRounded - currentForecast;
    const diffPct =
      currentForecast > 0
        ? Math.round(Math.abs((diff / currentForecast) * 100))
        : null;

    const typeAvg = eventTypeAvgs[eventType] ?? null;

    return {
      grossRevenue: grossRounded,
      netRevenue: netRounded,
      fee: feeRounded,
      diff,
      diffPct,
      weatherCoeff,
      dowCoeff,
      potentialBuyers: Math.round(potentialBuyers),
      conversionRate,
      marketShare,
      trucksNum,
      ticketNum,
      typeAvg,
    };
  }, [
    attendance,
    avgTicket,
    numTrucks,
    weather,
    isIndoor,
    feeType,
    feeRate,
    salesMinimum,
    event.event_type,
    event.event_date,
    calibratedCoefficients,
    currentForecast,
    eventTypeAvgs,
  ]);

  // ── Reset state when panel opens so it reflects fresh event data ──
  function handleOpen() {
    setAttendance(String(event.expected_attendance ?? ""));
    setAvgTicket("");
    setNumTrucks(String((event.other_trucks ?? 0) + 1));
    setWeather(event.event_weather ?? "Clear");
    setIsIndoor(false);
    setFeeType(event.fee_type ?? "none");
    setFeeRate(event.fee_rate ? String(event.fee_rate) : "");
    setSalesMinimum(event.sales_minimum ? String(event.sales_minimum) : "");
    setOpen(true);
  }

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        className="gap-1.5 text-xs h-7 px-2"
        onClick={handleOpen}
      >
        <Zap className="h-3 w-3" />
        What-If
      </Button>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent
          side="right"
          className="w-full sm:max-w-md overflow-y-auto p-0"
          showCloseButton
        >
          {/* ── Header ── */}
          <SheetHeader className="border-b px-5 py-4 gap-1">
            <div className="flex items-center gap-2 pr-8">
              <Zap className="h-4 w-4 text-primary shrink-0" />
              <SheetTitle className="text-base leading-tight">
                What-If: {event.event_name}
              </SheetTitle>
            </div>
            <SheetDescription className="text-xs">
              Tweak variables to see how the forecast changes — nothing is saved.
            </SheetDescription>
            <div className="flex items-center gap-2 mt-1 flex-wrap">
              <span className="text-xs text-muted-foreground">
                {new Date(event.event_date + "T00:00:00").toLocaleDateString(
                  "en-US",
                  { weekday: "short", month: "short", day: "numeric", year: "numeric" }
                )}
              </span>
              {event.event_type && (
                <Badge variant="outline" className="text-xs h-5">
                  {event.event_type}
                </Badge>
              )}
            </div>
          </SheetHeader>

          <div className="px-5 py-4 space-y-5">
            {/* ── Inputs ── */}
            <div className="space-y-4">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                Adjust Variables
              </p>

              {/* Attendance + Avg Ticket */}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">Expected Attendance</Label>
                  <Input
                    type="number"
                    onWheel={(e) => e.currentTarget.blur()}
                    min="0"
                    placeholder="e.g. 5000"
                    value={attendance}
                    onChange={(e) => setAttendance(e.target.value)}
                    className="h-8 text-sm"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Avg Ticket Price</Label>
                  <Input
                    type="number"
                    onWheel={(e) => e.currentTarget.blur()}
                    min="0"
                    step="0.01"
                    placeholder={`$${DEFAULT_TICKET} (default)`}
                    value={avgTicket}
                    onChange={(e) => setAvgTicket(e.target.value)}
                    className="h-8 text-sm"
                  />
                </div>
              </div>

              {/* Number of trucks */}
              <div className="space-y-1.5">
                <Label className="text-xs">
                  Number of Vendors at Event
                </Label>
                <Input
                  type="number"
                  onWheel={(e) => e.currentTarget.blur()}
                  min="1"
                  placeholder="1"
                  value={numTrucks}
                  onChange={(e) => setNumTrucks(e.target.value)}
                  className="h-8 text-sm"
                />
                <p className="text-xs text-muted-foreground">
                  More trucks = your share of buyers goes down
                </p>
              </div>

              {/* Weather */}
              <div className="space-y-1.5">
                <Label className="text-xs">Expected Weather</Label>
                <Select
                  value={isIndoor ? "Clear" : weather}
                  onValueChange={(v) => setWeather(v ?? "Clear")}
                  disabled={isIndoor}
                >
                  <SelectTrigger className="h-8 text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {WEATHER_TYPES.map((w) => (
                      <SelectItem key={w} value={w} className="text-sm">
                        {w}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Indoor toggle */}
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => setIsIndoor(!isIndoor)}
                  className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                    isIndoor ? "bg-primary" : "bg-muted"
                  }`}
                >
                  <span
                    className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${
                      isIndoor ? "translate-x-4" : "translate-x-0.5"
                    }`}
                  />
                </button>
                <Label
                  className="text-xs cursor-pointer"
                  onClick={() => setIsIndoor(!isIndoor)}
                >
                  Indoor event{" "}
                  {isIndoor && (
                    <span className="text-muted-foreground">
                      (weather doesn&apos;t apply)
                    </span>
                  )}
                </Label>
              </div>

              {/* Fee structure */}
              <div className="space-y-3 pt-1 border-t">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide pt-1">
                  Fee Structure
                </p>
                <div className="space-y-1.5">
                  <Label className="text-xs">Fee Type</Label>
                  <Select
                    value={feeType}
                    onValueChange={(v) => setFeeType(v ?? "none")}
                  >
                    <SelectTrigger className="h-8 text-sm">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(FEE_TYPE_LABELS).map(([v, l]) => (
                        <SelectItem key={v} value={v} className="text-sm">
                          {l}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {feeType !== "none" && feeType !== "pre_settled" && (
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label className="text-xs">
                        {feeType === "percentage" ||
                        feeType === "commission_with_minimum"
                          ? "Rate (%)"
                          : "Amount ($)"}
                      </Label>
                      <Input
                        type="number"
                        onWheel={(e) => e.currentTarget.blur()}
                        min="0"
                        placeholder="0"
                        value={feeRate}
                        onChange={(e) => setFeeRate(e.target.value)}
                        className="h-8 text-sm"
                      />
                    </div>
                    {feeType === "commission_with_minimum" && (
                      <div className="space-y-1.5">
                        <Label className="text-xs">Minimum ($)</Label>
                        <Input
                          type="number"
                          onWheel={(e) => e.currentTarget.blur()}
                          min="0"
                          placeholder="0"
                          value={salesMinimum}
                          onChange={(e) => setSalesMinimum(e.target.value)}
                          className="h-8 text-sm"
                        />
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* ── Live Results ── */}
            <div className="space-y-3 border-t pt-4">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                What-If Estimate
              </p>

              {!result ? (
                <div className="rounded-lg border border-dashed py-6 text-center">
                  <p className="text-xs text-muted-foreground">
                    Enter an attendance number to see your estimate.
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  {/* Main gross revenue */}
                  <div className="rounded-lg bg-primary/5 border border-primary/20 p-4 text-center space-y-1">
                    <p className="text-xs text-muted-foreground uppercase tracking-wide font-medium">
                      Estimated Gross Revenue
                    </p>
                    <p className="text-3xl font-bold text-primary">
                      {formatCurrency(result.grossRevenue)}
                    </p>
                    {result.fee > 0 && (
                      <p className="text-xs text-muted-foreground">
                        {formatCurrency(result.netRevenue)} net after{" "}
                        {formatCurrency(result.fee)} fee
                      </p>
                    )}
                  </div>

                  {/* Comparison to current forecast */}
                  <div className="rounded-lg border p-3 space-y-2">
                    <p className="text-xs font-medium text-muted-foreground">
                      vs. Current Forecast
                    </p>
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-muted-foreground">
                        Engine forecast
                      </span>
                      <span className="text-sm font-medium">
                        {formatCurrency(currentForecast)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-muted-foreground">
                        What-If estimate
                      </span>
                      <span className="text-sm font-semibold text-primary">
                        {formatCurrency(result.grossRevenue)}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5 pt-1 border-t">
                      {result.diff > 0 ? (
                        <>
                          <TrendingUp className="h-4 w-4 text-green-600 shrink-0" />
                          <span className="text-sm font-semibold text-green-600">
                            {formatCurrency(result.diff)} more than current forecast
                            {result.diffPct !== null && (
                              <span className="text-xs font-normal ml-1">
                                (+{result.diffPct}%)
                              </span>
                            )}
                          </span>
                        </>
                      ) : result.diff < 0 ? (
                        <>
                          <TrendingDown className="h-4 w-4 text-red-500 shrink-0" />
                          <span className="text-sm font-semibold text-red-500">
                            {formatCurrency(Math.abs(result.diff))} less than current forecast
                            {result.diffPct !== null && (
                              <span className="text-xs font-normal ml-1">
                                (-{result.diffPct}%)
                              </span>
                            )}
                          </span>
                        </>
                      ) : (
                        <>
                          <Minus className="h-4 w-4 text-muted-foreground shrink-0" />
                          <span className="text-sm text-muted-foreground">
                            Same as current forecast
                          </span>
                        </>
                      )}
                    </div>
                  </div>

                  {/* Calculation breakdown */}
                  <div className="rounded-lg border p-3 space-y-1.5">
                    <p className="text-xs font-medium text-muted-foreground mb-2">
                      How we got there
                    </p>
                    {[
                      {
                        line: `${result.potentialBuyers.toLocaleString()} est. buyers`,
                        note: `${(parseInt(attendance) || 0).toLocaleString()} × ${Math.round(result.conversionRate * 100)}% buy rate${result.trucksNum > 1 ? ` ÷ ${result.trucksNum} trucks` : ""}`,
                        cls: "",
                      },
                      {
                        line: `× $${result.ticketNum.toFixed(2)} avg ticket`,
                        note: "",
                        cls: "",
                      },
                      ...(result.weatherCoeff !== 1.0
                        ? [
                            {
                              line: `× ${result.weatherCoeff} weather (${weather})`,
                              note: "",
                              cls:
                                result.weatherCoeff < 1
                                  ? "text-orange-600"
                                  : "text-green-600",
                            },
                          ]
                        : []),
                      ...(result.dowCoeff !== 1.0
                        ? [
                            {
                              line: `× ${result.dowCoeff} day-of-week`,
                              note: "",
                              cls:
                                result.dowCoeff < 1
                                  ? "text-orange-600"
                                  : "text-green-600",
                            },
                          ]
                        : []),
                    ].map(({ line, note, cls }, i) => (
                      <div key={i}>
                        <p className={`text-xs text-muted-foreground ${cls}`}>
                          {line}
                        </p>
                        {note && (
                          <p className="text-xs text-muted-foreground/60 pl-2">
                            {note}
                          </p>
                        )}
                      </div>
                    ))}
                    <p className="text-xs font-medium text-foreground border-t pt-1.5 mt-1">
                      = {formatCurrency(result.grossRevenue)} estimated gross
                    </p>
                  </div>

                  {/* Historical type avg comparison if available */}
                  {result.typeAvg !== null && event.event_type && (
                    <div className="rounded-lg border p-3 space-y-2">
                      <p className="text-xs font-medium text-muted-foreground">
                        Your historical average
                      </p>
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-muted-foreground">
                          Avg {event.event_type}
                        </span>
                        <span className="text-sm font-medium">
                          {formatCurrency(result.typeAvg)}
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-muted-foreground">
                          What-If estimate
                        </span>
                        <span
                          className={`text-sm font-semibold ${
                            result.grossRevenue > result.typeAvg
                              ? "text-green-600"
                              : "text-orange-600"
                          }`}
                        >
                          {formatCurrency(result.grossRevenue)}{" "}
                          <span className="text-xs font-normal">
                            (
                            {result.grossRevenue > result.typeAvg ? "+" : ""}
                            {Math.round(
                              ((result.grossRevenue - result.typeAvg) /
                                result.typeAvg) *
                                100
                            )}
                            %)
                          </span>
                        </span>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* ── Footer note ── */}
            <p className="text-xs text-muted-foreground pb-2">
              This estimate uses attendance-based projection with conversion
              rates and weather/day-of-week adjustments. It does not update your
              saved forecast.
            </p>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
