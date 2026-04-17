"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
  Calculator,
  TrendingUp,
  DollarSign,
  Users,
  ArrowRight,
  Info,
  BarChart3,
  Utensils,
  CloudSun,
} from "lucide-react";
import { WEATHER_COEFFICIENTS, DAY_OF_WEEK_COEFFICIENTS, EVENT_TYPES, WEATHER_TYPES } from "@/lib/constants";
import type { Event } from "@/lib/database.types";
import type { CalibratedCoefficients } from "@/lib/forecast-engine";

// ─── Attendance conversion rates by event type ─────────────────────────────
// How many attendees typically buy from a food truck at this event type.
// Food-centric events convert high; sports/concerts compete with other vendors.

const CONVERSION_RATES: Record<string, number> = {
  "Festival":              0.40, // food-centric, high intent
  "Concert":               0.25, // captive but distracted, bar competes
  "Community/Neighborhood": 0.30, // browse and buy mentality
  "Corporate":             0.72, // hungry, it's the food option
  "Weekly Series":         0.35, // regulars, habitual buyers
  "Private/Catering":      0.85, // you're there for them specifically
  "Sports Event":          0.20, // stadium food competes heavily
  "Fundraiser/Charity":    0.35, // motivated to support, buy to contribute
};

const FEE_TYPE_LABELS: Record<string, string> = {
  none: "No Fee",
  flat_fee: "Flat Fee ($)",
  percentage: "Percentage (%)",
  commission_with_minimum: "Commission w/ Minimum",
  pre_settled: "Pre-Settled",
};

function formatCurrency(v: number) {
  return `$${v.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

function calcFee(gross: number, feeType: string, feeRate: number, salesMinimum: number): number {
  switch (feeType) {
    case "flat_fee": return feeRate;
    case "percentage": return gross * (feeRate / 100);
    case "commission_with_minimum": return Math.max(salesMinimum, gross * (feeRate / 100));
    case "pre_settled": return 0; // already net
    default: return 0;
  }
}

interface ForecastCalculatorProps {
  historicalEvents: Event[];
  overallAvg: number | null;
  eventTypeAvgs: Record<string, number>;
  calibratedCoefficients: CalibratedCoefficients | null;
  isPublic: boolean;
}

export function ForecastCalculator({
  historicalEvents,
  overallAvg,
  eventTypeAvgs,
  calibratedCoefficients,
  isPublic,
}: ForecastCalculatorProps) {
  const router = useRouter();

  // ── Inputs ──
  const [eventType, setEventType] = useState("");
  const [attendance, setAttendance] = useState("");
  const [avgTicket, setAvgTicket] = useState("");
  const [numTrucks, setNumTrucks] = useState("1");
  const [weather, setWeather] = useState("Clear");
  const [eventDate, setEventDate] = useState("");
  const [feeType, setFeeType] = useState("none");
  const [feeRate, setFeeRate] = useState("");
  const [salesMinimum, setSalesMinimum] = useState("");
  const [isIndoor, setIsIndoor] = useState(false);
  const [calculated, setCalculated] = useState(false);

  // ── Derived estimate ──
  const result = useMemo(() => {
    if (!calculated) return null;

    const attendanceNum = parseInt(attendance) || 0;
    const ticketNum = parseFloat(avgTicket) || 14; // $14 industry default
    const trucksNum = Math.max(1, parseInt(numTrucks) || 1);
    const feeRateNum = parseFloat(feeRate) || 0;
    const salesMinNum = parseFloat(salesMinimum) || 0;

    if (!eventType || attendanceNum === 0) return null;

    // Core formula
    const conversionRate = CONVERSION_RATES[eventType] ?? 0.30;
    const indoorMultiplier = isIndoor ? 1.08 : 1.0; // indoor slightly better (no weather attrition)
    const marketShare = 1 / trucksNum;

    const potentialBuyers = attendanceNum * conversionRate * indoorMultiplier * marketShare;
    let grossRevenue = potentialBuyers * ticketNum;

    // Weather adjustment (skip for indoor)
    let weatherCoeff = 1.0;
    if (!isIndoor && weather) {
      const calibW = calibratedCoefficients?.weather[weather];
      weatherCoeff = calibW ?? WEATHER_COEFFICIENTS[weather] ?? 1.0;
      grossRevenue *= weatherCoeff;
    }

    // Day-of-week adjustment
    let dowCoeff = 1.0;
    if (eventDate) {
      const dayName = new Date(eventDate + "T00:00:00").toLocaleDateString("en-US", { weekday: "long" });
      const calibD = calibratedCoefficients?.dayOfWeek[dayName];
      dowCoeff = calibD ?? DAY_OF_WEEK_COEFFICIENTS[dayName] ?? 1.0;
      grossRevenue *= dowCoeff;
    }

    const fee = calcFee(grossRevenue, feeType, feeRateNum, salesMinNum);
    const netRevenue = Math.max(0, grossRevenue - fee);

    // Historical comparison
    const typeAvg = eventTypeAvgs[eventType] ?? null;
    const hasHistory = historicalEvents.length >= 5;

    // Confidence
    let confidence: "HIGH" | "MEDIUM" | "LOW" = "LOW";
    if (hasHistory && typeAvg !== null) confidence = "MEDIUM";
    if (hasHistory && typeAvg !== null && attendanceNum > 0 && ticketNum > 0) confidence = "MEDIUM";
    if (historicalEvents.length >= 10 && typeAvg !== null) confidence = "HIGH";
    if (isPublic) confidence = "LOW"; // public always low (no personal data)

    return {
      grossRevenue: Math.round(grossRevenue),
      netRevenue: Math.round(netRevenue),
      fee: Math.round(fee),
      potentialBuyers: Math.round(potentialBuyers),
      conversionRate,
      marketShare,
      weatherCoeff,
      dowCoeff,
      typeAvg,
      hasHistory,
      confidence,
      ticketNum,
      trucksNum,
      attendanceNum,
    };
  }, [calculated, attendance, avgTicket, numTrucks, weather, eventDate, feeType, feeRate, salesMinimum, eventType, isIndoor, calibratedCoefficients, eventTypeAvgs, historicalEvents.length, isPublic]);

  function handleCalculate() {
    setCalculated(true);
  }

  function handleSaveAsEvent() {
    const params = new URLSearchParams({
      new: "true",
      ...(eventType && { event_type: eventType }),
      ...(eventDate && { event_date: eventDate }),
      ...(attendance && { expected_attendance: attendance }),
    });
    router.push(`/dashboard/events?${params.toString()}`);
  }

  const canCalculate = !!eventType && !!attendance;

  return (
    <div className="space-y-6 max-w-3xl">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Calculator className="h-6 w-6 text-primary" />
            Forecast Calculator
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Estimate revenue for any event before you commit — no booking required.
          </p>
        </div>
        {!isPublic && (
          <Link href="/dashboard/forecasts">
            <Button variant="outline" size="sm">← Forecasts</Button>
          </Link>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-5">
        {/* ── Input form ── */}
        <div className="lg:col-span-3 space-y-5">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Utensils className="h-4 w-4" />
                Event Details
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Event type */}
              <div className="space-y-1.5">
                <Label>Event Type <span className="text-destructive">*</span></Label>
                <Select value={eventType} onValueChange={(v) => { setEventType(v ?? ""); setCalculated(false); }}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select event type" />
                  </SelectTrigger>
                  <SelectContent>
                    {EVENT_TYPES.map((t) => (
                      <SelectItem key={t} value={t}>
                        <div className="flex items-center justify-between w-full gap-8">
                          <span>{t}</span>
                          <span className="text-xs text-muted-foreground">
                            ~{Math.round((CONVERSION_RATES[t] ?? 0.3) * 100)}% buy rate
                          </span>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {eventType && (
                  <p className="text-xs text-muted-foreground flex items-center gap-1">
                    <Info className="h-3 w-3" />
                    {Math.round((CONVERSION_RATES[eventType] ?? 0.3) * 100)}% estimated attendee buy rate for this event type
                  </p>
                )}
              </div>

              {/* Attendance + Ticket */}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Expected Attendance <span className="text-destructive">*</span></Label>
                  <Input
                    type="number"
                    placeholder="e.g. 5000"
                    value={attendance}
                    onChange={(e) => { setAttendance(e.target.value); setCalculated(false); }}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Avg Ticket Price</Label>
                  <Input
                    type="number"
                    placeholder="$14 (default)"
                    value={avgTicket}
                    onChange={(e) => { setAvgTicket(e.target.value); setCalculated(false); }}
                  />
                </div>
              </div>

              {/* Trucks */}
              <div className="space-y-1.5">
                <Label>Number of Food Trucks at Event</Label>
                <Input
                  type="number"
                  min="1"
                  placeholder="1"
                  value={numTrucks}
                  onChange={(e) => { setNumTrucks(e.target.value); setCalculated(false); }}
                />
                <p className="text-xs text-muted-foreground">
                  More trucks = your share of buyers goes down
                </p>
              </div>

              {/* Indoor toggle */}
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => { setIsIndoor(!isIndoor); setCalculated(false); }}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${isIndoor ? "bg-primary" : "bg-muted"}`}
                >
                  <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${isIndoor ? "translate-x-6" : "translate-x-1"}`} />
                </button>
                <Label className="cursor-pointer" onClick={() => { setIsIndoor(!isIndoor); setCalculated(false); }}>
                  Indoor event {isIndoor && <span className="text-xs text-muted-foreground">(weather doesn&apos;t apply)</span>}
                </Label>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <CloudSun className="h-4 w-4" />
                Conditions & Fees
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Date + Weather */}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Event Date</Label>
                  <Input
                    type="date"
                    value={eventDate}
                    onChange={(e) => { setEventDate(e.target.value); setCalculated(false); }}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Expected Weather</Label>
                  <Select
                    value={isIndoor ? "Clear" : weather}
                    onValueChange={(v) => { setWeather(v ?? "Clear"); setCalculated(false); }}
                    disabled={isIndoor}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {WEATHER_TYPES.map((w) => (
                        <SelectItem key={w} value={w}>{w}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* Fee */}
              <div className="grid grid-cols-3 gap-3">
                <div className="col-span-1 space-y-1.5">
                  <Label>Fee Type</Label>
                  <Select value={feeType} onValueChange={(v) => { setFeeType(v ?? "none"); setCalculated(false); }}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(FEE_TYPE_LABELS).map(([v, l]) => (
                        <SelectItem key={v} value={v}>{l}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                {feeType !== "none" && feeType !== "pre_settled" && (
                  <div className="space-y-1.5">
                    <Label>{feeType === "percentage" || feeType === "commission_with_minimum" ? "Rate (%)" : "Amount ($)"}</Label>
                    <Input
                      type="number"
                      placeholder="0"
                      value={feeRate}
                      onChange={(e) => { setFeeRate(e.target.value); setCalculated(false); }}
                    />
                  </div>
                )}
                {feeType === "commission_with_minimum" && (
                  <div className="space-y-1.5">
                    <Label>Minimum ($)</Label>
                    <Input
                      type="number"
                      placeholder="0"
                      value={salesMinimum}
                      onChange={(e) => { setSalesMinimum(e.target.value); setCalculated(false); }}
                    />
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          <Button
            className="w-full gap-2"
            size="lg"
            onClick={handleCalculate}
            disabled={!canCalculate}
          >
            <Calculator className="h-4 w-4" />
            Calculate Estimate
            <ArrowRight className="h-4 w-4" />
          </Button>
        </div>

        {/* ── Results panel ── */}
        <div className="lg:col-span-2 space-y-4">
          {!result ? (
            <Card className="border-dashed">
              <CardContent className="py-16 text-center">
                <Calculator className="h-10 w-10 mx-auto text-muted-foreground/30 mb-3" />
                <p className="text-sm text-muted-foreground">Fill in the event details and click Calculate to see your estimate.</p>
              </CardContent>
            </Card>
          ) : (
            <>
              {/* Main result */}
              <Card className="border-primary/30 bg-primary/5">
                <CardContent className="pt-6 space-y-4">
                  <div className="text-center">
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">Estimated Gross Revenue</p>
                    <p className="text-4xl font-bold text-primary">{formatCurrency(result.grossRevenue)}</p>
                    {result.fee > 0 && (
                      <p className="text-sm text-muted-foreground mt-1">
                        {formatCurrency(result.netRevenue)} net after {formatCurrency(result.fee)} fee
                      </p>
                    )}
                  </div>

                  {/* Confidence */}
                  <div className="flex items-center justify-center gap-2">
                    <Badge
                      variant="secondary"
                      className={
                        result.confidence === "HIGH" ? "bg-green-100 text-green-800" :
                        result.confidence === "MEDIUM" ? "bg-yellow-100 text-yellow-800" :
                        "bg-slate-100 text-slate-700"
                      }
                    >
                      {result.confidence} confidence
                    </Badge>
                    {!isPublic && !result.hasHistory && (
                      <span className="text-xs text-muted-foreground">Add more events to improve</span>
                    )}
                  </div>
                </CardContent>
              </Card>

              {/* Breakdown */}
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Users className="h-4 w-4" />
                    How we got there
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2 text-sm">
                  {[
                    [`${result.attendanceNum.toLocaleString()} attendees`, ""],
                    [`× ${Math.round(result.conversionRate * 100)}% buy rate (${eventType})`, ""],
                    ...(result.trucksNum > 1 ? [`÷ ${result.trucksNum} trucks (your share: ${Math.round(result.marketShare * 100)}%)`, ""] : []).map(v => [v, ""]),
                    [`= ~${result.potentialBuyers.toLocaleString()} buyers`, ""],
                    [`× $${result.ticketNum.toFixed(2)} avg ticket`, ""],
                    ...(result.weatherCoeff !== 1.0 ? [[`× ${result.weatherCoeff} weather factor (${weather})`, result.weatherCoeff < 1 ? "text-orange-600" : "text-green-600"]] : []),
                    ...(result.dowCoeff !== 1.0 && eventDate ? [[`× ${result.dowCoeff} day-of-week factor`, result.dowCoeff < 1 ? "text-orange-600" : "text-green-600"]] : []),
                  ].filter(Boolean).map(([line, cls], i) => (
                    <p key={i} className={`text-muted-foreground ${cls}`}>{String(line)}</p>
                  ))}
                  <div className="pt-2 border-t font-medium text-foreground">
                    = {formatCurrency(result.grossRevenue)} estimated gross
                  </div>
                </CardContent>
              </Card>

              {/* Historical comparison */}
              {!isPublic && result.typeAvg !== null && (
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm flex items-center gap-2">
                      <BarChart3 className="h-4 w-4" />
                      Your data says
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="text-sm space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">Your avg {eventType}</span>
                      <span className="font-medium">{formatCurrency(result.typeAvg)}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">This estimate</span>
                      <span className={`font-medium ${result.grossRevenue > result.typeAvg ? "text-green-600" : "text-orange-600"}`}>
                        {formatCurrency(result.grossRevenue)}
                        {" "}
                        ({result.grossRevenue > result.typeAvg ? "+" : ""}{Math.round(((result.grossRevenue - result.typeAvg) / result.typeAvg) * 100)}%)
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground pt-1">
                      Based on {Object.keys(eventTypeAvgs).length > 0 ? "your historical events" : "default industry rates"}
                    </p>
                  </CardContent>
                </Card>
              )}

              {/* Public CTA */}
              {isPublic && (
                <Card className="bg-orange-50 dark:bg-orange-950/20 border-orange-200 dark:border-orange-900/30">
                  <CardContent className="pt-5 text-center space-y-3">
                    <TrendingUp className="h-8 w-8 mx-auto text-orange-500" />
                    <p className="text-sm font-medium">Want forecasts calibrated to your actual history?</p>
                    <p className="text-xs text-muted-foreground">VendCast uses your real event data for accuracy — not just industry averages.</p>
                    <Link href="/signup">
                      <Button size="sm" className="w-full gap-1.5">
                        Start free trial
                        <ArrowRight className="h-3.5 w-3.5" />
                      </Button>
                    </Link>
                  </CardContent>
                </Card>
              )}

              {/* Save as event */}
              {!isPublic && (
                <Button variant="outline" className="w-full gap-2" onClick={handleSaveAsEvent}>
                  <DollarSign className="h-4 w-4" />
                  Save as upcoming event
                </Button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
